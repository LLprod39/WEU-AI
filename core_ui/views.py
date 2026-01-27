"""
WEU AI Agent - Views
Full-featured web interface for AI Agent system
"""
import asyncio
import json
import os
import uuid
from pathlib import Path
from datetime import datetime, timezone
from django.shortcuts import render
from django.http import StreamingHttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.views import LoginView
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods, require_GET
from django.conf import settings
from dotenv import load_dotenv
from loguru import logger

# Load environment variables
load_dotenv()

# Import core logic
from app.core.orchestrator import Orchestrator
from app.core.model_config import model_manager
from app.rag.engine import RAGEngine
from app.utils.file_processor import FileProcessor
from app.agents.manager import get_agent_manager

# Singleton instances
_orchestrator = None
_orchestrator_lock = asyncio.Lock()
_rag_engine = None


async def get_orchestrator():
    """Get or create orchestrator instance (protected by lock to avoid race condition)"""
    global _orchestrator
    async with _orchestrator_lock:
        if _orchestrator is None:
            model_manager.load_config()
            _orchestrator = Orchestrator()
            await _orchestrator.initialize()
    return _orchestrator


def get_rag_engine():
    """Get or create RAG engine instance"""
    global _rag_engine
    if _rag_engine is None:
        _rag_engine = RAGEngine()
    return _rag_engine


# ============================================
# Health Check (no auth)
# ============================================

@csrf_exempt
@require_GET
def api_health(request):
    """
    Health check endpoint. No auth, no heavy checks (no LLM, no DB/network for RAG if avoidable).
    Returns: status ('ok'|'degraded'|'error'), timestamp (ISO), services: {django, rag}.
    """
    try:
        services = {'django': 'ok'}
        # RAG: use cached engine if already created (no heavy init), else treat as ok if import works
        try:
            if _rag_engine is not None:
                services['rag'] = 'ok' if _rag_engine.available else 'unavailable'
            else:
                # avoid get_rag_engine() here — it can do heavy init; module already imported
                services['rag'] = 'ok'
        except Exception:
            services['rag'] = 'unavailable'
        status = 'degraded' if services.get('rag') == 'unavailable' else 'ok'
        return JsonResponse({
            'status': status,
            'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z',
            'services': services,
        })
    except Exception:
        return JsonResponse({
            'status': 'error',
            'timestamp': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z',
            'services': {'django': 'error', 'rag': 'unavailable'},
        }, status=500)


# ============================================
# Authentication Views
# ============================================

class CustomLoginView(LoginView):
    template_name = 'login.html'
    redirect_authenticated_user = True


# ============================================
# Public / Semi-Public Landing
# ============================================

def welcome_view(request):
    """Public landing page: pitch, gallery, features, trust, CTA. No auth required."""
    return render(request, 'welcome.html')


def docs_ui_guide_view(request):
    """Documentation: UI guide. No auth required."""
    return render(request, 'docs_ui_guide.html')


# ============================================
# Main Page Views
# ============================================

@login_required
def index(request):
    """Main chat interface"""
    default_provider = model_manager.config.default_provider
    context = {
        'default_provider': default_provider,
        'is_gemini_default': default_provider == 'gemini',
        'is_grok_default': default_provider == 'grok',
    }
    
    # Check for start_task_id
    task_id = request.GET.get('task_id')
    if task_id:
        try:
            # Lazy import to avoid circular dependency
            from tasks.models import Task
            task = Task.objects.get(id=task_id)
            initial_prompt = f"I need you to execute this task: '{task.title}'.\n\nDescription:\n{task.description}\n\nPlease analyze it and start working on it."
            context['initial_prompt'] = initial_prompt.replace('\n', '\\n').replace("'", "\\'")
        except Exception as exc:
            logger.warning(f"Failed to prefill task prompt for task_id={task_id}: {exc}")
            
    return render(request, 'chat.html', context)


@login_required
def orchestrator_view(request):
    """Orchestrator dashboard - shows agent workflow"""
    # Use cached orchestrator instance to avoid slow initialization
    # Tools will be loaded asynchronously via API
    context = {
        'tool_count': 0,  # Will be updated via API
    }
    return render(request, 'orchestrator.html', context)


@login_required
def knowledge_base_view(request):
    """Knowledge Base (RAG) management - optimized for fast loading"""
    rag = get_rag_engine()
    
    # Don't load all documents on page load - load via AJAX instead
    # This makes the page load much faster
    context = {
        'documents': [],  # Empty initially, loaded via AJAX
        'doc_count': 0,  # Will be updated via AJAX
        'rag_available': rag.available,
        'rag_type': 'Qdrant' if (hasattr(rag, 'use_qdrant') and rag.use_qdrant) else 'InMemory',
    }
    return render(request, 'knowledge_base.html', context)


@login_required
def settings_view(request):
    """Settings page — конфиг подгружается через /api/settings/ и /api/models/"""
    return render(request, 'settings.html', {})


# ============================================
# API Endpoints
# ============================================

@csrf_exempt
@login_required
async def chat_api(request):
    """
    Async API endpoint for chat streaming.
    Expects JSON: { "message": "user input", "model": "gemini/grok" }
    """
    if request.method != 'POST':
        return JsonResponse({'error': 'Method not allowed'}, status=405)

    try:
        data = json.loads(request.body)
        user_message = data.get('message', '')
        model = data.get('model', model_manager.config.default_provider)
        specific_model = data.get('specific_model')
        use_rag = data.get('use_rag', True)
        
        if not user_message:
            return JsonResponse({'error': 'Empty message'}, status=400)

        orchestrator = await get_orchestrator()

        async def event_stream():
            try:
                async for chunk in orchestrator.process_user_message(
                    user_message,
                    model_preference=model,
                    use_rag=use_rag,
                    specific_model=specific_model
                ):
                    yield chunk
            except Exception as e:
                yield f"\n\n❌ Error: {str(e)}"

        return StreamingHttpResponse(event_stream(), content_type='text/plain; charset=utf-8')

    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def rag_add_api(request):
    """Add text to RAG knowledge base"""
    try:
        data = json.loads(request.body)
        text = data.get('text', '')
        source = data.get('source', 'manual')
        
        if not text:
            return JsonResponse({'success': False, 'error': 'Empty text'}, status=400)
        
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({'success': False, 'error': 'RAG not available'}, status=503)
        
        doc_id = rag.add_text(text, source)
        
        if doc_id is None:
            return JsonResponse({
                'success': False,
                'error': 'Failed to add document to RAG'
            }, status=500)
        
        return JsonResponse({
            'success': True,
            'doc_id': doc_id,
            'message': 'Document added successfully'
        })
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.error(f"Error in rag_add_api: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def rag_query_api(request):
    """Query RAG knowledge base"""
    try:
        data = json.loads(request.body)
        query = data.get('query', '')
        n_results = data.get('n_results', 5)
        
        if not query:
            return JsonResponse({'success': False, 'error': 'Empty query'}, status=400)
        
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({
                'success': False,
                'error': 'RAG not available',
                'documents': [[]],
                'metadatas': [[]]
            }, status=503)
        
        try:
            results = rag.query(query, n_results)
            
            return JsonResponse({
                'success': True,
                'documents': results.get('documents', [[]]),
                'metadatas': results.get('metadatas', [[]])
            })
        except Exception as query_error:
            logger.error(f"Error querying RAG: {query_error}")
            return JsonResponse({
                'success': False,
                'error': f'Query failed: {str(query_error)}',
                'documents': [[]],
                'metadatas': [[]]
            }, status=500)
    except json.JSONDecodeError:
        return JsonResponse({
            'success': False,
            'error': 'Invalid JSON',
            'documents': [[]],
            'metadatas': [[]]
        }, status=400)
    except Exception as e:
        logger.error(f"Error in rag_query_api: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e),
            'documents': [[]],
            'metadatas': [[]]
        }, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def rag_reset_api(request):
    """Reset RAG database"""
    try:
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({'success': False, 'error': 'RAG not available'}, status=503)
        
        try:
            rag.reset_db()
            return JsonResponse({
                'success': True,
                'message': 'Database reset successfully'
            })
        except Exception as reset_error:
            logger.error(f"Error resetting RAG: {reset_error}")
            return JsonResponse({
                'success': False,
                'error': f'Reset failed: {str(reset_error)}'
            }, status=500)
    except Exception as e:
        logger.error(f"Error in rag_reset_api: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def rag_delete_api(request):
    """Delete a single document by id"""
    try:
        data = json.loads(request.body) if request.body else {}
        doc_id = data.get('doc_id') or data.get('id')
        if not doc_id:
            return JsonResponse({'success': False, 'error': 'doc_id required'}, status=400)
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({'success': False, 'error': 'RAG not available'}, status=503)
        removed = rag.delete_document(str(doc_id))
        if removed:
            return JsonResponse({'success': True, 'message': 'Document deleted'})
        return JsonResponse({'success': False, 'error': 'Document not found'}, status=404)
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        logger.error(f"Error in rag_delete_api: {e}")
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
def rag_documents_api(request):
    """Get documents from RAG with pagination - optimized for performance"""
    try:
        rag = get_rag_engine()
        if not rag.available:
            return JsonResponse({
                'success': False,
                'error': 'RAG not available',
                'documents': [],
                'doc_count': 0
            })
        
        # Get pagination parameters
        limit = int(request.GET.get('limit', 50))  # Default 50 documents
        offset = int(request.GET.get('offset', 0))
        
        # Get documents (limited for performance)
        all_documents = rag.get_documents(limit=limit + offset)
        
        # Apply pagination
        documents = all_documents[offset:offset + limit]
        total_count = len(all_documents) if offset == 0 else len(all_documents)
        
        return JsonResponse({
            'success': True,
            'documents': documents,
            'doc_count': total_count,
            'has_more': len(all_documents) > offset + limit
        })
    except Exception as e:
        logger.error(f"Error getting documents: {e}")
        return JsonResponse({
            'success': False,
            'error': str(e),
            'documents': [],
            'doc_count': 0
        })


@login_required
def api_tools_list(request):
    """Get list of available tools - uses get_orchestrator() with initialize(), no direct Orchestrator creation"""
    try:
        orchestrator = asyncio.run(get_orchestrator())
        tools = orchestrator.get_available_tools()
        return JsonResponse({'tools': tools, 'count': len(tools)})
    except Exception as e:
        logger.error(f"Error loading tools: {e}")
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def api_models_list(request):
    """Get list of available models for dropdowns"""
    try:
        gemini_models = model_manager.get_available_models('gemini')
        grok_models = model_manager.get_available_models('grok')
        c = model_manager.config
        return JsonResponse({
            'gemini': gemini_models,
            'grok': grok_models,
            'rag_defaults': [
                'models/text-embedding-004',
                'models/text-embedding-005',
                'models/embedding-001',
            ],
            'current': {
                'chat_gemini': c.chat_model_gemini,
                'chat_grok': c.chat_model_grok,
                'rag_model': c.rag_model,
                'agent_model_gemini': c.agent_model_gemini,
                'agent_model_grok': c.agent_model_grok,
                'default_provider': c.default_provider,
            }
        })
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def api_clear_history(request):
    """Clear conversation history - uses get_orchestrator() for consistent access"""
    try:
        orchestrator = asyncio.run(get_orchestrator())
        orchestrator.clear_history()
        return JsonResponse({'success': True, 'message': 'History cleared'})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["GET", "POST"])
def api_settings(request):
    """GET: return full settings config. POST: update settings."""
    if request.method == 'GET':
        try:
            model_manager.load_config()
            c = model_manager.config
            return JsonResponse({
                'success': True,
                'config': {
                    'default_provider': c.default_provider,
                    'chat_model_gemini': c.chat_model_gemini,
                    'chat_model_grok': c.chat_model_grok,
                    'rag_model': c.rag_model,
                    'agent_model_gemini': c.agent_model_gemini,
                    'agent_model_grok': c.agent_model_grok,
                },
                'api_keys': {
                    'gemini_set': bool(os.getenv('GEMINI_API_KEY')),
                    'grok_set': bool(os.getenv('GROK_API_KEY')),
                },
            })
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    if request.method == 'POST':
        try:
            data = json.loads(request.body)
            allowed = {
                'default_provider', 'chat_model_gemini', 'chat_model_grok',
                'rag_model', 'agent_model_gemini', 'agent_model_grok',
            }
            for key, value in data.items():
                if key in allowed and value is not None:
                    model_manager.update_config(**{key: value})
            model_manager.save_config()
            return JsonResponse({'success': True, 'message': 'Settings updated'})
        except Exception as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=500)

    return JsonResponse({'error': 'Method not allowed'}, status=405)


@login_required
@require_GET
def api_settings_check(request):
    """
    GET /api/settings/check/
    Returns: { configured: true|false, missing: ['gemini_key','grok_key'] }
    Checks that API keys in settings are non-empty.
    """
    try:
        gemini_ok = bool((os.getenv('GEMINI_API_KEY') or '').strip())
        grok_ok = bool((os.getenv('GROK_API_KEY') or '').strip())
        missing = []
        if not gemini_ok:
            missing.append('gemini_key')
        if not grok_ok:
            missing.append('grok_key')
        return JsonResponse({
            'configured': len(missing) == 0,
            'missing': missing,
        })
    except Exception as e:
        logger.exception('api_settings_check error: %s', e)
        return JsonResponse({'configured': False, 'missing': ['gemini_key', 'grok_key']}, status=500)


@login_required
def api_agents_list(request):
    """Get list of available agents"""
    try:
        agent_manager = get_agent_manager()
        agents = agent_manager.list_agents()
        return JsonResponse({'agents': agents})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
async def api_agent_execute(request):
    """Execute an agent with a task"""
    try:
        data = json.loads(request.body)
        agent_name = data.get('agent_name')
        task = data.get('task')
        context = data.get('context', {})
        
        if not agent_name or not task:
            return JsonResponse({'error': 'agent_name and task are required'}, status=400)
        
        agent_manager = get_agent_manager()
        result = await agent_manager.execute_agent(agent_name, task, context)
        
        return JsonResponse(result)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def api_upload_file(request):
    """Upload file and add to RAG"""
    try:
        if 'file' not in request.FILES:
            return JsonResponse({'error': 'No file provided'}, status=400)
        
        uploaded_file = request.FILES['file']
        filename = uploaded_file.name
        
        # Check if file type is supported
        if not FileProcessor.is_supported(filename):
            return JsonResponse({
                'error': f'Unsupported file type. Supported: {", ".join(FileProcessor.SUPPORTED_EXTENSIONS.keys())}'
            }, status=400)
        
        # Generate unique filename
        file_ext = Path(filename).suffix
        unique_filename = f"{uuid.uuid4()}{file_ext}"
        file_path = settings.UPLOADED_FILES_DIR / unique_filename
        
        # Save file
        with open(file_path, 'wb') as f:
            for chunk in uploaded_file.chunks():
                f.write(chunk)
        
        # Process file and extract text
        result = FileProcessor.process_file(str(file_path), filename)
        
        if result['error']:
            # Delete file if processing failed
            try:
                os.remove(file_path)
            except Exception as exc:
                logger.warning(f"Failed to remove uploaded file {file_path}: {exc}")
            return JsonResponse({'error': result['error']}, status=400)
        
        # Add to RAG
        rag = get_rag_engine()
        if rag.available and result['text']:
            doc_id = rag.add_text(
                result['text'],
                source=f"upload:{filename}"
            )
            result['metadata']['rag_doc_id'] = doc_id
        
        return JsonResponse({
            'success': True,
            'filename': filename,
            'text_preview': result['text'][:500] + '...' if len(result['text']) > 500 else result['text'],
            'text_length': len(result['text']),
            'metadata': result['metadata']
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
