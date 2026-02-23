import os
import asyncio
from google import genai
from loguru import logger
from typing import AsyncGenerator, Optional
from app.core.model_config import model_manager

# Таймаут для стрима Gemini (сек), экспоненциальная задержка при retry
GEMINI_STREAM_TIMEOUT = 90  # в диапазоне 60–120 сек
RETRY_BACKOFF = [1, 2, 4]


def _is_retryable_error(e: Exception) -> bool:
    """Проверка на 429 (rate limit) или 5xx — повторять с backoff."""
    s = str(e).lower()
    code = getattr(e, "status_code", None) or getattr(e, "code", None)
    if code is not None:
        if code == 429:
            return True
        if isinstance(code, int) and 500 <= code < 600:
            return True
    if "429" in s or "resource exhausted" in s or "rate" in s:
        return True
    if "503" in s or "502" in s or "500" in s or "internal" in s:
        return True
    return False


async def with_retry(coro, max_attempts: int = 3):
    """
    Обёртка с retry при 429/5xx.
    Экспоненциальная задержка: 1с, 2с, 4с.
    После max_attempts — пробрасывает ошибку.
    coro: корутина или callable, возвращающий корутину.
    """
    last_err = None
    for attempt in range(max_attempts):
        try:
            awaitable = coro() if callable(coro) and not asyncio.iscoroutine(coro) else coro
            return await awaitable
        except Exception as e:
            last_err = e
            if not _is_retryable_error(e) or attempt >= max_attempts - 1:
                raise
            delay = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
            logger.warning(f"Retryable error (attempt {attempt + 1}/{max_attempts}): {e}, sleep {delay}s")
            await asyncio.sleep(delay)
    if last_err is not None:
        raise last_err

class LLMProvider:
    def __init__(self):
        self.gemini_api_key = os.getenv("GEMINI_API_KEY")
        self.grok_api_key = os.getenv("GROK_API_KEY")
        self.anthropic_api_key = os.getenv("ANTHROPIC_API_KEY")
        self.openai_api_key = os.getenv("OPENAI_API_KEY") or os.getenv("CODEX_API_KEY")

        # Set keys in model manager
        model_manager.set_api_keys(
            self.gemini_api_key,
            self.grok_api_key,
            self.anthropic_api_key,
            self.openai_api_key,
        )

        # Lazy initialization of clients
        self._gemini_client = None
        self._anthropic_client = None

    def _get_gemini_client(self):
        """Lazy load Gemini client only when enabled"""
        if not model_manager.config.gemini_enabled:
            return None
        
        if self._gemini_client is None and self.gemini_api_key:
            try:
                self._gemini_client = genai.Client(api_key=self.gemini_api_key)
                logger.info("Configured Gemini client")
            except Exception as e:
                logger.error(f"Failed to configure Gemini: {e}")
                self._gemini_client = None
        
        return self._gemini_client
    
    @property
    def gemini_client(self):
        """Property for backward compatibility"""
        return self._get_gemini_client()

    def _get_anthropic_client(self):
        """Lazy load Anthropic client only when enabled"""
        if not model_manager.config.claude_enabled:
            return None
        if self._anthropic_client is None and self.anthropic_api_key:
            try:
                import anthropic
                self._anthropic_client = anthropic.AsyncAnthropic(api_key=self.anthropic_api_key)
                logger.info("Configured Anthropic client")
            except Exception as e:
                logger.error(f"Failed to configure Anthropic: {e}")
                self._anthropic_client = None
        return self._anthropic_client

    def set_api_key(self, model: str, key: str):
        if model == "gemini":
            self.gemini_api_key = key
            model_manager.set_api_keys(gemini_key=key)
            self._gemini_client = None
        elif model == "grok":
            self.grok_api_key = key
            model_manager.set_api_keys(grok_key=key)
        elif model == "claude":
            self.anthropic_api_key = key
            model_manager.set_api_keys(anthropic_key=key)
            self._anthropic_client = None
        elif model == "openai":
            self.openai_api_key = key
            model_manager.set_api_keys(openai_key=key)

    async def stream_chat(self, prompt: str, model: str = "gemini", specific_model: str = None) -> AsyncGenerator[str, None]:
        """
        Stream chat response from the selected model.
        
        Args:
            prompt: The prompt to send
            model: Provider name (auto/gemini/grok/openai/claude). При «auto» используется internal_llm_provider из config.
            specific_model: Specific model to use (overrides config)
        """
        # «auto» = используем internal_llm_provider, с автоматическим fallback на первый включённый
        if model == "auto" or not model:
            preferred = model_manager.config.internal_llm_provider or "grok"
            # Check if preferred provider is actually enabled; if not — pick first available
            def _enabled(p: str) -> bool:
                if p == "grok":
                    return model_manager.config.grok_enabled and bool(self.grok_api_key)
                if p == "gemini":
                    return model_manager.config.gemini_enabled and bool(self.gemini_api_key)
                if p == "claude":
                    return model_manager.config.claude_enabled and bool(self.anthropic_api_key)
                if p == "openai":
                    return model_manager.config.openai_enabled and bool(self.openai_api_key)
                return False

            if _enabled(preferred):
                model = preferred
            else:
                # Fallback: pick first enabled provider
                for candidate in ("openai", "claude", "grok", "gemini"):
                    if _enabled(candidate):
                        model = candidate
                        logger.warning(
                            f"internal_llm_provider '{preferred}' is disabled/unconfigured, "
                            f"falling back to '{model}'"
                        )
                        break
                else:
                    model = preferred  # Will fail with proper error message below
            logger.info(f"Using internal_llm_provider: {model} (preferred: {preferred})")
        logger.info(f"Streaming chat from {model} with prompt: {prompt[:50]}...")
        
        if model == "gemini":
            # Check if Gemini is enabled
            if not model_manager.config.gemini_enabled:
                yield "Error: Gemini API disabled. Enable in settings or use CLI agent (ralph/cursor/claude)."
                return
            
            if not self.gemini_client:
                yield "Error: Gemini API Key not configured."
                return

            target_model = specific_model or model_manager.get_chat_model("gemini")
            logger.info(f"Using Gemini model: {target_model}")
            max_attempts = 3

            for attempt in range(max_attempts):
                try:
                    async def consume():
                        out = []
                        # generate_content_stream возвращает корутину; нужен await перед async for
                        stream = await self.gemini_client.aio.models.generate_content_stream(
                            model=target_model,
                            contents=prompt
                        )
                        async for chunk in stream:
                            if chunk.text:
                                out.append(chunk.text)
                        return out

                    chunks = await asyncio.wait_for(consume(), timeout=GEMINI_STREAM_TIMEOUT)
                    for c in chunks:
                        yield c
                    return
                except asyncio.TimeoutError:
                    logger.error("Gemini stream timeout")
                    yield "Error: Timeout (Gemini stream)."
                    return
                except Exception as e:
                    if _is_retryable_error(e) and attempt < max_attempts - 1:
                        yield "[Повтор попытки...]"
                        delay = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                        await asyncio.sleep(delay)
                    else:
                        logger.error(f"Gemini Error: {e}")
                        yield f"Error calling Gemini: {str(e)}"
                        return

        elif model == "grok":
            # Check if Grok is enabled
            if not model_manager.config.grok_enabled:
                yield "Error: Grok API disabled. Enable in settings or use CLI agent (ralph/cursor/claude)."
                return
            
            if not self.grok_api_key:
                yield "Error: Grok API Key not configured."
                return

            import aiohttp
            import json

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.grok_api_key}"
            }
            grok_model = specific_model or model_manager.get_chat_model("grok")
            data = {
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": prompt}
                ],
                "model": grok_model,
                "stream": True,
                "temperature": 0.7
            }
            # ClientTimeout(total=60) — уже используется для Grok
            timeout = aiohttp.ClientTimeout(total=60.0)
            max_attempts = 3

            for attempt in range(max_attempts):
                try:
                    async with aiohttp.ClientSession(timeout=timeout) as session:
                        async with session.post("https://api.x.ai/v1/chat/completions", headers=headers, json=data) as response:
                            if response.status == 200:
                                async for line_bytes in response.content:
                                    line = line_bytes.decode('utf-8').strip()
                                    if line.startswith("data: "):
                                        chunk_str = line[6:]
                                        if chunk_str == "[DONE]":
                                            break
                                        try:
                                            chunk_json = json.loads(chunk_str)
                                            content = chunk_json.get("choices", [{}])[0].get("delta", {}).get("content", "")
                                            if content:
                                                yield content
                                        except json.JSONDecodeError:
                                            continue
                                return
                            error_text = await response.text()
                            is_retryable = response.status == 429 or (500 <= response.status < 600)
                            if is_retryable and attempt < max_attempts - 1:
                                yield "[Повтор попытки...]"
                                delay = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                                await asyncio.sleep(delay)
                            else:
                                yield f"Error from Grok API: {response.status} - {error_text}"
                                return
                except Exception as e:
                    err_retryable = _is_retryable_error(e) and attempt < max_attempts - 1
                    if err_retryable:
                        yield "[Повтор попытки...]"
                        delay = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                        await asyncio.sleep(delay)
                    else:
                        logger.error(f"Grok Error: {e}")
                        yield f"Error calling Grok: {str(e)}"
                        return
        
        elif model == "claude":
            if not model_manager.config.claude_enabled:
                yield "Error: Claude API disabled. Enable in settings."
                return

            client = self._get_anthropic_client()
            if not client:
                yield "Error: Anthropic API Key not configured."
                return

            target_model = specific_model or model_manager.get_chat_model("claude")
            logger.info(f"Using Claude model: {target_model}")
            max_attempts = 3

            for attempt in range(max_attempts):
                try:
                    import anthropic as _anthropic_pkg
                    async with client.messages.stream(
                        model=target_model,
                        max_tokens=8192,
                        messages=[{"role": "user", "content": prompt}],
                    ) as stream:
                        async for text in stream.text_stream:
                            yield text
                    return
                except Exception as e:
                    if _is_retryable_error(e) and attempt < max_attempts - 1:
                        yield "[Повтор попытки...]"
                        delay = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                        await asyncio.sleep(delay)
                    else:
                        logger.error(f"Claude Error: {e}")
                        yield f"Error calling Claude: {str(e)}"
                        return
        
        elif model == "openai":
            if not model_manager.config.openai_enabled:
                yield "Error: OpenAI API disabled. Enable in settings."
                return

            if not self.openai_api_key:
                yield "Error: OpenAI API Key not configured."
                return

            import aiohttp
            import json

            target_model = specific_model or model_manager.get_chat_model("openai")
            logger.info(f"Using OpenAI model: {target_model}")

            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.openai_api_key}",
            }
            data = {
                "model": target_model,
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": prompt},
                ],
                "stream": True,
            }
            timeout = aiohttp.ClientTimeout(total=90.0)
            max_attempts = 3

            for attempt in range(max_attempts):
                try:
                    async with aiohttp.ClientSession(timeout=timeout) as session:
                        async with session.post("https://api.openai.com/v1/chat/completions", headers=headers, json=data) as response:
                            if response.status == 200:
                                async for line_bytes in response.content:
                                    line = line_bytes.decode("utf-8").strip()
                                    if not line.startswith("data: "):
                                        continue
                                    chunk_str = line[6:]
                                    if chunk_str == "[DONE]":
                                        break
                                    try:
                                        chunk_json = json.loads(chunk_str)
                                    except json.JSONDecodeError:
                                        continue

                                    content = chunk_json.get("choices", [{}])[0].get("delta", {}).get("content", "")
                                    if content:
                                        yield content
                                return

                            error_text = await response.text()
                            is_retryable = response.status == 429 or (500 <= response.status < 600)
                            if is_retryable and attempt < max_attempts - 1:
                                yield "[Повтор попытки...]"
                                delay = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                                await asyncio.sleep(delay)
                            else:
                                yield f"Error from OpenAI API: {response.status} - {error_text}"
                                return
                except Exception as e:
                    err_retryable = _is_retryable_error(e) and attempt < max_attempts - 1
                    if err_retryable:
                        yield "[Повтор попытки...]"
                        delay = RETRY_BACKOFF[min(attempt, len(RETRY_BACKOFF) - 1)]
                        await asyncio.sleep(delay)
                    else:
                        logger.error(f"OpenAI Error: {e}")
                        yield f"Error calling OpenAI: {str(e)}"
                        return

        else:
            yield f"Unknown model: {model}"
