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
        
        # Set keys in model manager
        model_manager.set_api_keys(self.gemini_api_key, self.grok_api_key)
        
        self._configure_gemini()

    def _configure_gemini(self):
        if self.gemini_api_key:
            try:
                # Create client with API key
                self.gemini_client = genai.Client(api_key=self.gemini_api_key)
                logger.info("Configured Gemini client")
            except Exception as e:
                logger.error(f"Failed to configure Gemini: {e}")
                self.gemini_client = None
        else:
            logger.warning("GEMINI_API_KEY not found.")
            self.gemini_client = None

    def set_api_key(self, model: str, key: str):
        if model == "gemini":
            self.gemini_api_key = key
            model_manager.set_api_keys(gemini_key=key)
            self._configure_gemini()
        elif model == "grok":
            self.grok_api_key = key
            model_manager.set_api_keys(grok_key=key)

    async def stream_chat(self, prompt: str, model: str = "gemini", specific_model: str = None) -> AsyncGenerator[str, None]:
        """
        Stream chat response from the selected model.
        
        Args:
            prompt: The prompt to send
            model: Provider name (gemini/grok)
            specific_model: Specific model to use (overrides config)
        """
        logger.info(f"Streaming chat from {model} with prompt: {prompt[:50]}...")
        
        if model == "gemini":
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
                        async for chunk in self.gemini_client.aio.models.generate_content_stream(
                            model=target_model,
                            contents=prompt
                        ):
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
        
        else:
            yield f"Unknown model: {model}"
