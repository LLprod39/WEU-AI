"""
Server Management Views
"""
import json
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Q
from django.utils import timezone
from django.contrib.auth.models import User
from django.db import transaction
from .models import (
    Server,
    ServerGroup,
    ServerConnection,
    ServerCommandHistory,
    ServerGroupMember,
    ServerGroupTag,
    ServerGroupSubscription,
)
from app.tools.ssh_tools import ssh_manager
from passwords.encryption import PasswordEncryption


@login_required
def server_list(request):
    """List all servers for the user"""
    servers = Server.objects.filter(user=request.user, is_active=True)
    
    # Filter by group
    group_id = request.GET.get('group')
    if group_id:
        servers = servers.filter(group_id=group_id)
    
    # Search
    search = request.GET.get('search')
    if search:
        servers = servers.filter(
            Q(name__icontains=search) |
            Q(host__icontains=search) |
            Q(username__icontains=search)
        )
    
    groups = ServerGroup.objects.filter(
        Q(user=request.user) | Q(memberships__user=request.user)
    ).distinct()
    group_tags = ServerGroupTag.objects.filter(user=request.user)
    
    return render(request, 'servers/list.html', {
        'servers': servers,
        'groups': groups,
        'group_tags': group_tags,
    })


def _get_group_role(group: ServerGroup, user: User) -> str:
    if group.user_id == user.id:
        return "owner"
    membership = ServerGroupMember.objects.filter(group=group, user=user).first()
    return membership.role if membership else ""


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def group_create(request):
    data = json.loads(request.body)
    name = data.get("name", "").strip()
    if not name:
        return JsonResponse({"error": "Group name required"}, status=400)

    group = ServerGroup.objects.create(
        user=request.user,
        name=name,
        description=data.get("description", ""),
        color=data.get("color", "#3b82f6"),
    )
    ServerGroupMember.objects.create(group=group, user=request.user, role="owner")

    tag_ids = data.get("tag_ids", [])
    if tag_ids:
        group.tags.set(ServerGroupTag.objects.filter(id__in=tag_ids, user=request.user))

    return JsonResponse({"success": True, "group_id": group.id})


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def group_update(request, group_id):
    group = get_object_or_404(ServerGroup, id=group_id)
    role = _get_group_role(group, request.user)
    if role not in ["owner", "admin"]:
        return JsonResponse({"error": "Permission denied"}, status=403)

    data = json.loads(request.body)
    group.name = data.get("name", group.name)
    group.description = data.get("description", group.description)
    group.color = data.get("color", group.color)
    group.save()

    if "tag_ids" in data:
        group.tags.set(ServerGroupTag.objects.filter(id__in=data.get("tag_ids", []), user=request.user))

    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def group_delete(request, group_id):
    group = get_object_or_404(ServerGroup, id=group_id)
    if _get_group_role(group, request.user) != "owner":
        return JsonResponse({"error": "Only owner can delete group"}, status=403)
    group.delete()
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def group_add_member(request, group_id):
    group = get_object_or_404(ServerGroup, id=group_id)
    role = _get_group_role(group, request.user)
    if role not in ["owner", "admin"]:
        return JsonResponse({"error": "Permission denied"}, status=403)

    data = json.loads(request.body)
    identifier = data.get("user")
    member_role = data.get("role", "member")
    if not identifier:
        return JsonResponse({"error": "User required"}, status=400)

    user = User.objects.filter(username=identifier).first() or User.objects.filter(email=identifier).first()
    if not user:
        return JsonResponse({"error": "User not found"}, status=404)

    ServerGroupMember.objects.update_or_create(group=group, user=user, defaults={"role": member_role})
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def group_remove_member(request, group_id):
    group = get_object_or_404(ServerGroup, id=group_id)
    role = _get_group_role(group, request.user)
    if role not in ["owner", "admin"]:
        return JsonResponse({"error": "Permission denied"}, status=403)

    data = json.loads(request.body)
    user_id = data.get("user_id")
    if not user_id:
        return JsonResponse({"error": "User required"}, status=400)
    ServerGroupMember.objects.filter(group=group, user_id=user_id).delete()
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def group_subscribe(request, group_id):
    group = get_object_or_404(ServerGroup, id=group_id)
    data = json.loads(request.body)
    kind = data.get("kind", "follow")
    if kind not in ["follow", "favorite"]:
        return JsonResponse({"error": "Invalid kind"}, status=400)
    ServerGroupSubscription.objects.update_or_create(group=group, user=request.user, kind=kind)
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def bulk_update_servers(request):
    data = json.loads(request.body)
    server_ids = data.get("server_ids", [])
    if not server_ids:
        return JsonResponse({"error": "server_ids required"}, status=400)

    updates = {}
    if "group_id" in data:
        group_id = data.get("group_id")
        if group_id:
            group = get_object_or_404(ServerGroup, id=group_id)
            if _get_group_role(group, request.user) == "":
                return JsonResponse({"error": "Permission denied"}, status=403)
        updates["group_id"] = group_id

    if "tags" in data:
        updates["tags"] = data.get("tags", "")

    if "is_active" in data:
        updates["is_active"] = bool(data.get("is_active"))

    Server.objects.filter(user=request.user, id__in=server_ids).update(**updates)
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def server_create(request):
    """Create a new server"""
    try:
        data = json.loads(request.body)
        
        group = None
        group_id = data.get('group_id')
        if group_id:
            try:
                group = ServerGroup.objects.get(id=group_id)
                if _get_group_role(group, request.user) == "":
                    return JsonResponse({'error': 'Permission denied for group'}, status=403)
            except ServerGroup.DoesNotExist:
                return JsonResponse({'error': 'Invalid group'}, status=400)
        
        # Create server
        server = Server.objects.create(
            user=request.user,
            name=data.get('name', ''),
            host=data.get('host', ''),
            port=data.get('port', 22),
            username=data.get('username', ''),
            auth_method=data.get('auth_method', 'password'),
            key_path=data.get('key_path', ''),
            tags=data.get('tags', ''),
            notes=data.get('notes', ''),
            group=group,
        )
        
        # Encrypt password if provided
        password = data.get('password', '')
        master_password = data.get('master_password', '')
        if password and master_password:
            server.salt = PasswordEncryption.generate_salt()
            server.encrypted_password = PasswordEncryption.encrypt_password(
                password,
                master_password,
                bytes(server.salt)
            )
            server.save()
        
        return JsonResponse({
            'success': True,
            'server_id': server.id,
            'message': 'Server created successfully'
        })
        
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def server_test_connection(request, server_id):
    """Test connection to server"""
    try:
        server = get_object_or_404(Server, id=server_id, user=request.user)
        data = json.loads(request.body)
        master_password = data.get('master_password', '')
        
        # Get password if needed
        password = None
        if server.auth_method in ['password', 'key_password']:
            if server.encrypted_password and master_password:
                password = PasswordEncryption.decrypt_password(
                    server.encrypted_password,
                    master_password,
                    bytes(server.salt)
                )
            else:
                password = data.get('password', '')
        
        # Test connection using SSH tools
        from asgiref.sync import async_to_sync
        
        async def test_conn():
            try:
                conn_id = await ssh_manager.connect(
                    host=server.host,
                    username=server.username,
                    password=password,
                    key_path=server.key_path if server.auth_method in ['key', 'key_password'] else None,
                    port=server.port
                )
                # Disconnect immediately after test
                await ssh_manager.disconnect(conn_id)
                return {'success': True, 'message': 'Connection successful'}
            except Exception as e:
                return {'success': False, 'error': str(e)}
        
        result = async_to_sync(test_conn)()
        
        if result['success']:
            server.last_connected = timezone.now()
            server.save(update_fields=['last_connected'])
        
        return JsonResponse(result)
        
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_http_methods(["POST"])
def server_execute_command(request, server_id):
    """Execute command on server"""
    try:
        server = get_object_or_404(Server, id=server_id, user=request.user)
        data = json.loads(request.body)
        command = data.get('command', '')
        master_password = data.get('master_password', '')
        
        if not command:
            return JsonResponse({'error': 'Command required'}, status=400)
        
        # Get password if needed
        password = None
        if server.auth_method in ['password', 'key_password']:
            if server.encrypted_password and master_password:
                password = PasswordEncryption.decrypt_password(
                    server.encrypted_password,
                    master_password,
                    bytes(server.salt)
                )
            else:
                password = data.get('password', '')
        
        # Execute command
        from asgiref.sync import async_to_sync
        from app.tools.ssh_tools import SSHExecuteTool
        
        async def exec_cmd():
            try:
                # Connect
                conn_id = await ssh_manager.connect(
                    host=server.host,
                    username=server.username,
                    password=password,
                    key_path=server.key_path if server.auth_method in ['key', 'key_password'] else None,
                    port=server.port
                )
                
                # Execute
                execute_tool = SSHExecuteTool()
                result = await execute_tool.execute(conn_id=conn_id, command=command)
                
                # Save to history
                ServerCommandHistory.objects.create(
                    server=server,
                    user=request.user,
                    command=command,
                    output=result if isinstance(result, str) else str(result),
                    exit_code=0  # Assume success if no error
                )
                
                # Disconnect
                await ssh_manager.disconnect(conn_id)
                
                return {'success': True, 'output': result}
            except Exception as e:
                return {'success': False, 'error': str(e)}
        
        result = async_to_sync(exec_cmd)()
        return JsonResponse(result)
        
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)
