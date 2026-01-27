"""
Password Manager Views
"""
import json
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Q
from .models import Credential, CredentialCategory, CredentialTag
from .encryption import PasswordEncryption


@login_required
def password_list(request):
    """List all credentials for the user"""
    credentials = Credential.objects.filter(user=request.user)
    
    # Filter by category if provided
    category_id = request.GET.get('category')
    if category_id:
        credentials = credentials.filter(category_id=category_id)
    
    # Search
    search = request.GET.get('search')
    if search:
        credentials = credentials.filter(
            Q(name__icontains=search) |
            Q(username__icontains=search) |
            Q(email__icontains=search) |
            Q(url__icontains=search)
        )
    
    categories = CredentialCategory.objects.all()
    
    return render(request, 'passwords/list.html', {
        'credentials': credentials,
        'categories': categories,
    })


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def credential_create(request):
    """Create a new credential"""
    try:
        data = json.loads(request.body)
        master_password = data.get('master_password')
        password = data.get('password', '')
        
        if not master_password:
            return JsonResponse({'error': 'Master password required'}, status=400)
        if not password:
            return JsonResponse({'error': 'Password required'}, status=400)
        
        category = None
        category_id = data.get('category_id')
        if category_id:
            try:
                category = CredentialCategory.objects.get(id=category_id)
            except CredentialCategory.DoesNotExist:
                return JsonResponse({'error': 'Invalid category'}, status=400)
        
        salt = PasswordEncryption.generate_salt()
        encrypted_password = PasswordEncryption.encrypt_password(password, master_password, salt)
        
        # Create credential
        credential = Credential.objects.create(
            user=request.user,
            name=data.get('name', ''),
            username=data.get('username', ''),
            email=data.get('email', ''),
            url=data.get('url', ''),
            notes=data.get('notes', ''),
            category=category,
            encrypted_password=encrypted_password,
            salt=salt,
        )
        
        return JsonResponse({
            'success': True,
            'credential_id': credential.id,
            'message': 'Credential created successfully'
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def credential_decrypt(request, credential_id):
    """Decrypt and return password"""
    try:
        credential = get_object_or_404(Credential, id=credential_id, user=request.user)
        data = json.loads(request.body)
        master_password = data.get('master_password')
        
        if not master_password:
            return JsonResponse({'error': 'Master password required'}, status=400)
        
        # Decrypt password
        password = credential.decrypt_password(master_password)
        
        # Update last accessed
        credential.update_last_accessed()
        
        # Log access
        from .models import CredentialAccessLog
        CredentialAccessLog.objects.create(
            credential=credential,
            user=request.user,
            action='decrypted',
            ip_address=request.META.get('REMOTE_ADDR'),
            user_agent=request.META.get('HTTP_USER_AGENT', '')
        )
        
        return JsonResponse({
            'success': True,
            'password': password
        })
        
    except ValueError as e:
        return JsonResponse({'error': str(e)}, status=400)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def generate_password(request):
    """Generate a random password"""
    try:
        data = json.loads(request.body)
        length = data.get('length', 16)
        include_symbols = data.get('include_symbols', True)
        
        password = PasswordEncryption.generate_password(length, include_symbols)
        
        return JsonResponse({
            'success': True,
            'password': password
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
