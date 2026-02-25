"""
Server Management Views
"""
import json
import os
from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.contrib.auth.models import User
from django.db import transaction
from .models import (
    Server,
    ServerShare,
    ServerGroup,
    ServerConnection,
    ServerCommandHistory,
    ServerGroupMember,
    ServerGroupTag,
    ServerGroupSubscription,
    GlobalServerRules,
)
from app.tools.ssh_tools import ssh_manager
from passwords.encryption import PasswordEncryption
from core_ui.activity import log_user_activity
from core_ui.models import UserActivityLog
from core_ui.decorators import require_feature
from core_ui.middleware import get_template_name


@login_required
@require_feature('servers', redirect_on_forbidden=True)
def server_list(request):
    """List all servers for the user"""
    servers = Server.objects.filter(user=request.user, is_active=True).select_related("group", "user")
    
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

    servers = list(servers)
    for s in servers:
        s.share_access_kind = "owner"
        s.share_context_enabled = True
        s.share_expires_at = None
        s.shared_by_user = None

    now = timezone.now()
    shared_links = (
        ServerShare.objects.select_related("server", "server__group", "server__user", "shared_by")
        .filter(user=request.user, is_revoked=False, server__is_active=True)
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        .order_by("server__name")
    )
    shared_servers: list[Server] = []
    for link in shared_links:
        srv = link.server
        srv.share_access_kind = "shared"
        srv.share_context_enabled = bool(link.share_context)
        srv.share_expires_at = link.expires_at
        srv.shared_by_user = link.shared_by or srv.user
        srv.share_link_id = link.id
        shared_servers.append(srv)
    
    groups = ServerGroup.objects.filter(
        Q(user=request.user) | Q(memberships__user=request.user)
    ).distinct()
    group_tags = ServerGroupTag.objects.filter(user=request.user)
    global_rules, _ = GlobalServerRules.objects.get_or_create(user=request.user)

    # Mobile or desktop template
    if getattr(request, 'is_mobile', False):
        template = 'servers/mobile/list.html'
    else:
        template = 'servers/list.html'

    return render(request, template, {
        'servers': servers,
        'shared_servers': shared_servers,
        'owned_server_count': len(servers),
        'shared_server_count': len(shared_servers),
        'total_server_count': len(servers) + len(shared_servers),
        'groups': groups,
        'group_tags': group_tags,
        'global_rules': global_rules,
    })


@login_required
@require_feature('servers', redirect_on_forbidden=True)
def server_terminal_page(request, server_id: int):
    """
    Full-page SSH terminal (mobile-first). Desktop also supported as a page fallback.
    WebSocket endpoint is handled by Channels consumer.
    """
    accessible_qs = _accessible_servers_queryset(request.user)
    server = get_object_or_404(accessible_qs, id=server_id)
    all_servers = accessible_qs.exclude(id=server_id)
    share = _active_server_share(server, request.user)
    template = 'servers/mobile/terminal.html' if getattr(request, 'is_mobile', False) else 'servers/terminal.html'
    return render(request, template, {
        'server': server,
        'all_servers': all_servers,
        'is_shared_server': bool(share),
        'share_context_enabled': bool(share.share_context) if share else True,
    })


@login_required
@require_feature('servers', redirect_on_forbidden=True)
def multi_terminal(request):
    """
    Multi-terminal hub - multiple SSH sessions in tabs.
    """
    servers = _accessible_servers_queryset(request.user)
    return render(request, 'servers/multi_terminal.html', {'servers': servers})


@login_required
@require_feature('servers', redirect_on_forbidden=True)
def terminal_minimal(request, server_id: int):
    """
    Minimal terminal for popup window - no navigation chrome.
    """
    accessible_qs = _accessible_servers_queryset(request.user)
    server = get_object_or_404(accessible_qs, id=server_id)
    all_servers = accessible_qs.exclude(id=server_id)
    share = _active_server_share(server, request.user)
    return render(request, 'servers/terminal_minimal.html', {
        'server': server,
        'all_servers': all_servers,
        'is_shared_server': bool(share),
        'share_context_enabled': bool(share.share_context) if share else True,
    })


def _get_group_role(group: ServerGroup, user: User) -> str:
    if group.user_id == user.id:
        return "owner"
    membership = ServerGroupMember.objects.filter(group=group, user=user).first()
    return membership.role if membership else ""


def _active_share_q(user: User) -> Q:
    now = timezone.now()
    return (
        Q(shares__user=user, shares__is_revoked=False)
        & (Q(shares__expires_at__isnull=True) | Q(shares__expires_at__gt=now))
    )


def _accessible_servers_queryset(user: User):
    return (
        Server.objects.select_related("group", "user")
        .filter(is_active=True)
        .filter(Q(user=user) | _active_share_q(user))
        .distinct()
    )


def _active_server_share(server: Server, user: User) -> ServerShare | None:
    if not server or server.user_id == user.id:
        return None
    now = timezone.now()
    return (
        ServerShare.objects.filter(server=server, user=user, is_revoked=False)
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        .first()
    )


def _effective_master_password(request, data: dict | None = None) -> str:
    """Resolve master password from payload, session, or env."""
    data = data or {}
    from_payload = str(data.get("master_password") or "").strip()
    if from_payload:
        return from_payload

    try:
        from_session = str(request.session.get("_mp") or "").strip()
    except Exception:
        from_session = ""
    if from_session:
        return from_session

    return str(os.environ.get("MASTER_PASSWORD") or "").strip()


def _resolve_server_secret(server: Server, request, data: dict) -> str | None:
    """
    Resolve server password/passphrase from encrypted secret or direct payload.
    """
    if server.auth_method not in ["password", "key_password"]:
        return None

    direct_secret = str(data.get("password") or "").strip()
    if server.encrypted_password:
        master_password = _effective_master_password(request, data)
        if not master_password:
            return direct_secret or None
        try:
            return PasswordEncryption.decrypt_password(
                server.encrypted_password,
                master_password,
                bytes(server.salt or b""),
            )
        except Exception:
            if direct_secret:
                return direct_secret
            raise ValueError("Не удалось расшифровать пароль сервера. Проверь MASTER_PASSWORD в .env.")

    return direct_secret or None


def _parse_expires_at(raw_value):
    if raw_value in (None, "", "null", "None"):
        return None
    dt = parse_datetime(str(raw_value))
    if not dt:
        return None
    if timezone.is_naive(dt):
        dt = timezone.make_aware(dt, timezone.get_current_timezone())
    return dt


@csrf_exempt
@login_required
@require_feature('servers')
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

    log_user_activity(
        user=request.user,
        request=request,
        category='servers',
        action='group_create',
        status=UserActivityLog.STATUS_SUCCESS,
        description=f'Created server group "{group.name}"',
        entity_type='server_group',
        entity_id=group.id,
        entity_name=group.name,
    )

    return JsonResponse({"success": True, "group_id": group.id})


@csrf_exempt
@login_required
@require_feature('servers')
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

    log_user_activity(
        user=request.user,
        request=request,
        category='servers',
        action='group_update',
        status=UserActivityLog.STATUS_SUCCESS,
        description=f'Updated server group "{group.name}"',
        entity_type='server_group',
        entity_id=group.id,
        entity_name=group.name,
    )

    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def group_delete(request, group_id):
    group = get_object_or_404(ServerGroup, id=group_id)
    if _get_group_role(group, request.user) != "owner":
        return JsonResponse({"error": "Only owner can delete group"}, status=403)
    group_name = group.name
    group.delete()
    log_user_activity(
        user=request.user,
        request=request,
        category='servers',
        action='group_delete',
        status=UserActivityLog.STATUS_SUCCESS,
        description=f'Deleted server group "{group_name}"',
        entity_type='server_group',
        entity_id=group_id,
        entity_name=group_name,
    )
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('servers')
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
@require_feature('servers')
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
@require_feature('servers')
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
@require_feature('servers')
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

    updated_count = Server.objects.filter(user=request.user, id__in=server_ids).update(**updates)
    if updated_count:
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='servers_bulk_update',
            status=UserActivityLog.STATUS_SUCCESS,
            description=f'Bulk updated {updated_count} servers',
            entity_type='server',
            entity_name='bulk',
            metadata={
                'server_ids': server_ids[:200],
                'updated_fields': sorted(list(updates.keys())),
                'updated_count': updated_count,
            },
        )
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def server_create(request):
    """Create a new server"""
    try:
        data = json.loads(request.body)

        # Validate and normalize core fields
        raw_port = data.get("port", 22)
        try:
            port = int(raw_port)
        except (TypeError, ValueError):
            return JsonResponse({"error": "Invalid port"}, status=400)
        if port < 1 or port > 65535:
            return JsonResponse({"error": "Port must be in range 1..65535"}, status=400)

        server_type = str(data.get("server_type", "ssh") or "ssh").strip().lower()
        if server_type not in ("ssh", "rdp"):
            return JsonResponse({"error": "Invalid server_type"}, status=400)

        group = None
        group_id = data.get("group_id")
        if isinstance(group_id, str):
            group_id = group_id.strip()
        if group_id in ("", "null", "None"):
            group_id = None
        if group_id is not None:
            try:
                group_id = int(group_id)
            except (TypeError, ValueError):
                return JsonResponse({"error": "Invalid group_id"}, status=400)
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
            server_type=server_type,
            host=data.get('host', ''),
            port=port,
            username=data.get('username', ''),
            auth_method=data.get('auth_method', 'password'),
            key_path=data.get('key_path', ''),
            tags=data.get('tags', ''),
            notes=data.get('notes', ''),
            corporate_context=data.get('corporate_context', ''),
            group=group,
        )
        
        # Encrypt password if provided (master password comes from payload/session/env)
        password = str(data.get('password', '') or '').strip()
        master_password = _effective_master_password(request, data)
        if password and master_password:
            server.salt = PasswordEncryption.generate_salt()
            server.encrypted_password = PasswordEncryption.encrypt_password(
                password,
                master_password,
                bytes(server.salt)
            )
            server.save()
        elif password and not master_password:
            return JsonResponse({'error': 'MASTER_PASSWORD is required to encrypt server password'}, status=400)
        
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_create',
            status=UserActivityLog.STATUS_SUCCESS,
            description=f'Created server "{server.name}"',
            entity_type='server',
            entity_id=server.id,
            entity_name=server.name,
            metadata={
                'host': server.host,
                'port': server.port,
                'server_type': server.server_type,
                'group_id': server.group_id,
            },
        )

        return JsonResponse({
            'success': True,
            'server_id': server.id,
            'message': 'Server created successfully'
        })
        
    except Exception as e:
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_create',
            status=UserActivityLog.STATUS_ERROR,
            description=f'Server create failed: {e}',
            entity_type='server',
        )
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def server_update(request, server_id):
    """Update server configuration including network_config"""
    try:
        server = get_object_or_404(Server, id=server_id, user=request.user)
        data = json.loads(request.body)
        
        # Update basic fields
        if 'name' in data:
            server.name = data['name']
        if 'host' in data:
            server.host = data['host']
        if 'port' in data:
            try:
                port = int(data['port'])
            except (TypeError, ValueError):
                return JsonResponse({'error': 'Invalid port'}, status=400)
            if port < 1 or port > 65535:
                return JsonResponse({'error': 'Port must be in range 1..65535'}, status=400)
            server.port = port
        if 'username' in data:
            server.username = data['username']
        if 'server_type' in data:
            server_type = str(data.get('server_type') or '').strip().lower()
            if server_type not in ('ssh', 'rdp'):
                return JsonResponse({'error': 'Invalid server_type'}, status=400)
            server.server_type = server_type
        if 'auth_method' in data:
            server.auth_method = data['auth_method']
        if 'key_path' in data:
            server.key_path = data['key_path']
        if 'tags' in data:
            server.tags = data['tags']
        if 'notes' in data:
            server.notes = data['notes']
        if 'corporate_context' in data:
            server.corporate_context = data['corporate_context']
        if 'is_active' in data:
            server.is_active = data['is_active']
        
        # Update group
        if 'group_id' in data:
            group_id = data.get('group_id')
            if isinstance(group_id, str):
                group_id = group_id.strip()
            if group_id in ("", "null", "None"):
                group_id = None

            if group_id is not None:
                try:
                    group_id = int(group_id)
                except (TypeError, ValueError):
                    return JsonResponse({'error': 'Invalid group_id'}, status=400)
                try:
                    group = ServerGroup.objects.get(id=group_id)
                    if _get_group_role(group, request.user) == "":
                        return JsonResponse({'error': 'Permission denied for group'}, status=403)
                    server.group = group
                except ServerGroup.DoesNotExist:
                    return JsonResponse({'error': 'Invalid group'}, status=400)
            else:
                server.group = None
        
        # Update network_config
        if 'network_config' in data:
            network_config = data['network_config']
            if isinstance(network_config, dict):
                server.network_config = network_config
                # Обновляем helper flags
                server.update_network_flags()
        
        # Update password if provided (master password comes from payload/session/env)
        if 'password' in data:
            password = str(data.get('password') or '').strip()
            master_password = _effective_master_password(request, data)
            if password and master_password:
                server.salt = PasswordEncryption.generate_salt()
                server.encrypted_password = PasswordEncryption.encrypt_password(
                    password,
                    master_password,
                    bytes(server.salt)
                )
            elif password and not master_password:
                return JsonResponse({'error': 'MASTER_PASSWORD is required to encrypt server password'}, status=400)
        
        changed_fields = sorted(list(data.keys()))
        server.save()
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_update',
            status=UserActivityLog.STATUS_SUCCESS,
            description=f'Updated server "{server.name}"',
            entity_type='server',
            entity_id=server.id,
            entity_name=server.name,
            metadata={'changed_fields': changed_fields},
        )
        
        return JsonResponse({
            'success': True,
            'message': 'Server updated successfully',
            'server': {
                'id': server.id,
                'name': server.name,
                'host': server.host,
                'port': server.port,
                'network_context': server.get_network_context_summary()
            }
        })
        
    except Exception as e:
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_update',
            status=UserActivityLog.STATUS_ERROR,
            description=f'Server update failed: {e}',
            entity_type='server',
            entity_id=server_id,
        )
        return JsonResponse({'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def server_test_connection(request, server_id):
    """Test connection to server"""
    try:
        server = get_object_or_404(_accessible_servers_queryset(request.user), id=server_id)
        data = json.loads(request.body)
        try:
            password = _resolve_server_secret(server, request, data)
        except ValueError as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=400)
        
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
            log_user_activity(
                user=request.user,
                request=request,
                category='servers',
                action='server_test_connection',
                status=UserActivityLog.STATUS_SUCCESS,
                description=f'Server connection test succeeded for "{server.name}"',
                entity_type='server',
                entity_id=server.id,
                entity_name=server.name,
                metadata={'host': server.host, 'port': server.port},
            )
        else:
            log_user_activity(
                user=request.user,
                request=request,
                category='servers',
                action='server_test_connection',
                status=UserActivityLog.STATUS_ERROR,
                description=f'Server connection test failed for "{server.name}": {result.get("error", "unknown error")}',
                entity_type='server',
                entity_id=server.id,
                entity_name=server.name,
                metadata={'host': server.host, 'port': server.port},
            )
        
        return JsonResponse(result)
        
    except Exception as e:
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_test_connection',
            status=UserActivityLog.STATUS_ERROR,
            description=f'Server connection test failed: {e}',
            entity_type='server',
            entity_id=server_id,
        )
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def server_execute_command(request, server_id):
    """Execute command on server"""
    try:
        server = get_object_or_404(_accessible_servers_queryset(request.user), id=server_id)
        data = json.loads(request.body)
        command = data.get('command', '')
        
        if not command:
            return JsonResponse({'error': 'Command required'}, status=400)
        
        try:
            password = _resolve_server_secret(server, request, data)
        except ValueError as e:
            return JsonResponse({'success': False, 'error': str(e)}, status=400)
        
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
                out_str = result.get('stdout', '') + (result.get('stderr') or '')
                ServerCommandHistory.objects.create(
                    server=server,
                    user=request.user,
                    command=command,
                    output=out_str or str(result),
                    exit_code=result.get('exit_code', 0)
                )
                
                # Disconnect
                await ssh_manager.disconnect(conn_id)
                
                return {'success': True, 'output': result}
            except Exception as e:
                return {'success': False, 'error': str(e)}
        
        result = async_to_sync(exec_cmd)()
        if result.get('success'):
            output = result.get('output') or {}
            command_preview = command if len(command) <= 400 else command[:397] + '...'
            log_user_activity(
                user=request.user,
                request=request,
                category='servers',
                action='server_command_execute',
                status=UserActivityLog.STATUS_SUCCESS,
                description=f'Executed command on "{server.name}": {command_preview}',
                entity_type='server',
                entity_id=server.id,
                entity_name=server.name,
                metadata={
                    'command': command_preview,
                    'exit_code': output.get('exit_code'),
                },
            )
        else:
            log_user_activity(
                user=request.user,
                request=request,
                category='servers',
                action='server_command_execute',
                status=UserActivityLog.STATUS_ERROR,
                description=f'Command execution failed on "{server.name}": {result.get("error", "unknown error")}',
                entity_type='server',
                entity_id=server.id,
                entity_name=server.name,
                metadata={'command': command[:400]},
            )
        return JsonResponse(result)

    except Exception as e:
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_command_execute',
            status=UserActivityLog.STATUS_ERROR,
            description=f'Command execution failed: {e}',
            entity_type='server',
            entity_id=server_id,
        )
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def server_delete(request, server_id):
    """Delete a server"""
    try:
        server = get_object_or_404(Server, id=server_id, user=request.user)
        server_name = server.name
        server.delete()
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_delete',
            status=UserActivityLog.STATUS_SUCCESS,
            description=f'Deleted server "{server_name}"',
            entity_type='server',
            entity_id=server_id,
            entity_name=server_name,
        )
        return JsonResponse({'success': True, 'message': 'Server deleted'})
    except Exception as e:
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_delete',
            status=UserActivityLog.STATUS_ERROR,
            description=f'Server delete failed: {e}',
            entity_type='server',
            entity_id=server_id,
        )
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_feature('servers')
@require_http_methods(["GET"])
def server_share_list(request, server_id):
    """List shares for an owned server."""
    server = get_object_or_404(Server, id=server_id, user=request.user, is_active=True)
    now = timezone.now()
    shares = (
        ServerShare.objects.select_related("user", "shared_by")
        .filter(server=server, is_revoked=False)
        .order_by("-created_at")
    )
    payload = []
    for share in shares:
        active = share.expires_at is None or share.expires_at > now
        payload.append(
            {
                "id": share.id,
                "user_id": share.user_id,
                "username": share.user.username,
                "email": share.user.email or "",
                "share_context": bool(share.share_context),
                "expires_at": share.expires_at.isoformat() if share.expires_at else None,
                "created_at": share.created_at.isoformat() if share.created_at else None,
                "is_active": active and not share.is_revoked,
            }
        )
    return JsonResponse({"success": True, "shares": payload})


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def server_share_create(request, server_id):
    """Create or update share for an owned server."""
    try:
        server = get_object_or_404(Server, id=server_id, user=request.user, is_active=True)
        data = json.loads(request.body)

        identifier = str(data.get("user") or "").strip()
        if not identifier:
            return JsonResponse({"error": "User (username/email/id) required"}, status=400)

        target_user = None
        if identifier.isdigit():
            target_user = User.objects.filter(id=int(identifier)).first()
        if not target_user:
            target_user = User.objects.filter(username=identifier).first() or User.objects.filter(email=identifier).first()
        if not target_user:
            return JsonResponse({"error": "User not found"}, status=404)
        if target_user.id == request.user.id:
            return JsonResponse({"error": "Cannot share server with yourself"}, status=400)

        raw_expires = data.get("expires_at")
        expires_at = _parse_expires_at(raw_expires)
        if raw_expires not in (None, "", "null", "None") and not expires_at:
            return JsonResponse({"error": "Invalid expires_at format (use ISO datetime)"}, status=400)
        if expires_at and expires_at <= timezone.now():
            return JsonResponse({"error": "expires_at must be in the future"}, status=400)

        share_context = bool(data.get("share_context", True))

        share, _ = ServerShare.objects.update_or_create(
            server=server,
            user=target_user,
            defaults={
                "shared_by": request.user,
                "share_context": share_context,
                "expires_at": expires_at,
                "is_revoked": False,
                "revoked_at": None,
            },
        )

        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_share_create',
            status=UserActivityLog.STATUS_SUCCESS,
            description=f'Shared server "{server.name}" with user "{target_user.username}"',
            entity_type='server_share',
            entity_id=share.id,
            entity_name=server.name,
            metadata={
                'server_id': server.id,
                'shared_with_user_id': target_user.id,
                'shared_with_username': target_user.username,
                'share_context': bool(share_context),
                'expires_at': share.expires_at.isoformat() if share.expires_at else None,
            },
        )

        return JsonResponse(
            {
                "success": True,
                "share": {
                    "id": share.id,
                    "user_id": share.user_id,
                    "username": share.user.username,
                    "email": share.user.email or "",
                    "share_context": bool(share.share_context),
                    "expires_at": share.expires_at.isoformat() if share.expires_at else None,
                    "created_at": share.created_at.isoformat() if share.created_at else None,
                    "is_active": share.is_active(),
                },
            }
        )
    except Exception as e:
        log_user_activity(
            user=request.user,
            request=request,
            category='servers',
            action='server_share_create',
            status=UserActivityLog.STATUS_ERROR,
            description=f'Server share create failed: {e}',
            entity_type='server',
            entity_id=server_id,
        )
        return JsonResponse({"error": str(e)}, status=500)


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def server_share_revoke(request, server_id, share_id):
    """Revoke previously issued share."""
    server = get_object_or_404(Server, id=server_id, user=request.user, is_active=True)
    share = get_object_or_404(ServerShare, id=share_id, server=server)
    if not share.is_revoked:
        share.is_revoked = True
        share.revoked_at = timezone.now()
        share.save(update_fields=["is_revoked", "revoked_at", "updated_at"])
    log_user_activity(
        user=request.user,
        request=request,
        category='servers',
        action='server_share_revoke',
        status=UserActivityLog.STATUS_SUCCESS,
        description=f'Revoked server share for "{server.name}"',
        entity_type='server_share',
        entity_id=share.id,
        entity_name=server.name,
        metadata={
            'server_id': server.id,
            'shared_user_id': share.user_id,
            'shared_username': share.user.username,
        },
    )
    return JsonResponse({"success": True})


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def set_master_password(request):
    """Store master password in session for auto-connect"""
    try:
        data = json.loads(request.body)
        mp = data.get('master_password', '')
        if mp:
            request.session['_mp'] = mp
            request.session.set_expiry(0)  # Expires when browser closes
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)


@login_required
@require_feature('servers')
def get_master_password(request):
    """Get master password from session (for auto-connect check)"""
    has_mp = bool(request.session.get('_mp'))
    return JsonResponse({'has_master_password': has_mp})


@login_required
@require_feature('servers')
def clear_master_password(request):
    """Clear master password from session"""
    request.session.pop('_mp', None)
    return JsonResponse({'success': True})


@login_required
@require_feature('servers')
@require_http_methods(["GET"])
def global_context_get(request):
    """Get global server rules/context for current user"""
    rules, _ = GlobalServerRules.objects.get_or_create(user=request.user)
    return JsonResponse({
        'rules': rules.rules,
        'forbidden_commands': rules.forbidden_commands,
        'required_checks': rules.required_checks,
        'environment_vars': rules.environment_vars,
    })


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def global_context_save(request):
    """Save global server rules/context for current user"""
    try:
        data = json.loads(request.body)
        rules, _ = GlobalServerRules.objects.get_or_create(user=request.user)
        if 'rules' in data:
            rules.rules = data['rules']
        if 'forbidden_commands' in data:
            fc = data['forbidden_commands']
            if isinstance(fc, str):
                fc = [c.strip() for c in fc.splitlines() if c.strip()]
            rules.forbidden_commands = fc
        if 'required_checks' in data:
            rc = data['required_checks']
            if isinstance(rc, str):
                rc = [c.strip() for c in rc.splitlines() if c.strip()]
            rules.required_checks = rc
        if 'environment_vars' in data:
            rules.environment_vars = data['environment_vars']
        rules.save()
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_feature('servers')
@require_http_methods(["GET"])
def group_context_get(request, group_id):
    """Get context (rules, forbidden_commands, environment_vars) for a group"""
    group = get_object_or_404(ServerGroup, id=group_id)
    role = _get_group_role(group, request.user)
    if not role:
        return JsonResponse({'error': 'Permission denied'}, status=403)
    return JsonResponse({
        'id': group.id,
        'name': group.name,
        'rules': group.rules,
        'forbidden_commands': group.forbidden_commands,
        'environment_vars': group.environment_vars,
    })


@csrf_exempt
@login_required
@require_feature('servers')
@require_http_methods(["POST"])
def group_context_save(request, group_id):
    """Save context (rules, forbidden_commands, environment_vars) for a group"""
    group = get_object_or_404(ServerGroup, id=group_id)
    role = _get_group_role(group, request.user)
    if role not in ["owner", "admin"]:
        return JsonResponse({'error': 'Permission denied'}, status=403)
    try:
        data = json.loads(request.body)
        if 'rules' in data:
            group.rules = data['rules']
        if 'forbidden_commands' in data:
            fc = data['forbidden_commands']
            if isinstance(fc, str):
                fc = [c.strip() for c in fc.splitlines() if c.strip()]
            group.forbidden_commands = fc
        if 'environment_vars' in data:
            group.environment_vars = data['environment_vars']
        group.save()
        return JsonResponse({'success': True})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_feature('servers')
@require_http_methods(["GET"])
def server_get(request, server_id):
    """Get server details for editing"""
    server = get_object_or_404(Server, id=server_id, user=request.user)
    return JsonResponse({
        'id': server.id,
        'name': server.name,
        'server_type': server.server_type,
        'host': server.host,
        'port': server.port,
        'username': server.username,
        'auth_method': server.auth_method,
        'key_path': server.key_path,
        'tags': server.tags,
        'notes': server.notes,
        'corporate_context': server.corporate_context,
        'group_id': server.group_id,
        'is_active': server.is_active,
        'network_config': server.network_config,
    })
