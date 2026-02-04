"""
Views для управления командами (группы пользователей).
"""
import json
import logging
from django.shortcuts import render, get_object_or_404, redirect
from django.urls import reverse
from django.http import JsonResponse, HttpResponseForbidden
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.views.decorators.http import require_http_methods, require_POST, require_GET
from django.db.models import Q, Count

from .models import (
    Team, TeamMember, TeamMemberRole,
    Project, ProjectMember, ProjectMemberRole,
)
from .permissions import ProjectPermissions

logger = logging.getLogger(__name__)


def _get_teams_for_user(user):
    """Команды, в которых пользователь состоит."""
    return Team.objects.filter(members__user=user).distinct().order_by('name')


def _can_manage_team(user, team):
    membership = TeamMember.objects.filter(team=team, user=user).first()
    return membership and membership.can_manage_team()


def _can_view_team(user, team):
    return TeamMember.objects.filter(team=team, user=user).exists()


# =============================================================================
# TEAM CRUD
# =============================================================================

@login_required
def team_list(request):
    """Список команд пользователя."""
    teams = _get_teams_for_user(request.user).annotate(
        member_count=Count('members'),
        task_count=Count('tasks'),
    )
    context = {
        'teams': teams,
    }
    return render(request, 'tasks/teams/team_list.html', context)


@login_required
@require_http_methods(['GET', 'POST'])
def team_create(request):
    """Создать команду. GET — форма, POST — создание."""
    if request.method == 'GET':
        return render(request, 'tasks/teams/team_form.html', {'team': None})

    try:
        data = json.loads(request.body) if request.content_type == 'application/json' else request.POST.dict()
        name = (data.get('name') or '').strip()
        slug = (data.get('slug') or '').strip().lower().replace(' ', '-')
        description = (data.get('description') or '').strip()
        color = (data.get('color') or '#6366f1').strip()

        if not name:
            return JsonResponse({'error': 'Название обязательно'}, status=400)
        if not slug:
            slug = name.lower().replace(' ', '-')[:50]
        if Team.objects.filter(slug=slug).exists():
            return JsonResponse({'error': 'Команда с таким кодом уже существует'}, status=400)

        team = Team.objects.create(
            name=name,
            slug=slug,
            description=description,
            color=color,
            owner=request.user,
        )
        TeamMember.objects.create(team=team, user=request.user, role=TeamMemberRole.OWNER)

        if request.content_type == 'application/json':
            return JsonResponse({'success': True, 'team_id': team.id, 'url': reverse('tasks:team_detail', args=[team.id])})
        return redirect('tasks:team_detail', team.id)
    except Exception as e:
        logger.exception(e)
        return JsonResponse({'error': str(e)}, status=500)


@login_required
def team_detail(request, pk):
    """Детали команды и участники."""
    team = get_object_or_404(Team, pk=pk)
    if not _can_view_team(request.user, team):
        return HttpResponseForbidden('Нет доступа к команде')

    members = TeamMember.objects.filter(team=team).select_related('user').order_by('-role', 'user__username')
    context = {
        'team': team,
        'members': members,
        'can_manage': _can_manage_team(request.user, team),
    }
    return render(request, 'tasks/teams/team_detail.html', context)


@login_required
@require_http_methods(['GET', 'POST'])
def team_edit(request, pk):
    """Редактировать команду."""
    team = get_object_or_404(Team, pk=pk)
    if not _can_manage_team(request.user, team):
        return HttpResponseForbidden('Нет прав на редактирование')

    if request.method == 'GET':
        return render(request, 'tasks/teams/team_form.html', {'team': team})

    try:
        data = json.loads(request.body) if request.content_type == 'application/json' else request.POST.dict()
        team.name = (data.get('name') or team.name).strip()
        team.description = (data.get('description') or '').strip()
        team.color = (data.get('color') or team.color).strip()
        slug = (data.get('slug') or team.slug).strip().lower().replace(' ', '-')
        if slug and slug != team.slug and Team.objects.filter(slug=slug).exists():
            return JsonResponse({'error': 'Команда с таким кодом уже существует'}, status=400)
        if slug:
            team.slug = slug
        team.save()

        if request.content_type == 'application/json':
            return JsonResponse({'success': True, 'url': reverse('tasks:team_detail', args=[team.id])})
        return redirect('tasks:team_detail', team.id)
    except Exception as e:
        logger.exception(e)
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def team_delete(request, pk):
    """Удалить команду."""
    team = get_object_or_404(Team, pk=pk)
    if team.owner != request.user:
        return JsonResponse({'error': 'Только владелец может удалить команду'}, status=403)
    team.delete()
    if request.content_type == 'application/json' or request.headers.get('Accept') == 'application/json':
        return JsonResponse({'success': True})
    return redirect('tasks:team_list')


# =============================================================================
# TEAM MEMBERS
# =============================================================================

@login_required
@require_POST
def team_member_add(request, pk):
    """Добавить участника в команду (по user_id или email)."""
    team = get_object_or_404(Team, pk=pk)
    if not _can_manage_team(request.user, team):
        return JsonResponse({'error': 'Нет прав'}, status=403)

    try:
        data = json.loads(request.body)
        user_id = data.get('user_id')
        email = (data.get('email') or '').strip().lower()
        role = data.get('role', TeamMemberRole.MEMBER)

        if role not in [r[0] for r in TeamMemberRole.choices]:
            role = TeamMemberRole.MEMBER

        user = None
        if user_id:
            user = User.objects.filter(id=user_id).first()
        if not user and email:
            user = User.objects.filter(email=email).first()

        if not user:
            return JsonResponse({'error': 'Пользователь не найден'}, status=400)
        if TeamMember.objects.filter(team=team, user=user).exists():
            return JsonResponse({'error': 'Уже в команде'}, status=400)

        TeamMember.objects.create(team=team, user=user, role=role)
        return JsonResponse({
            'success': True,
            'member': {
                'id': user.id,
                'username': user.username,
                'email': user.email or '',
                'role': role,
            },
        })
    except Exception as e:
        logger.exception(e)
        return JsonResponse({'error': str(e)}, status=500)


@login_required
@require_POST
def team_member_remove(request, pk, user_id):
    """Удалить участника из команды."""
    team = get_object_or_404(Team, pk=pk)
    if not _can_manage_team(request.user, team):
        return JsonResponse({'error': 'Нет прав'}, status=403)

    membership = get_object_or_404(TeamMember, team=team, user_id=user_id)
    if membership.role == TeamMemberRole.OWNER:
        return JsonResponse({'error': 'Нельзя удалить владельца'}, status=400)
    membership.delete()
    return JsonResponse({'success': True})


@login_required
@require_POST
def team_member_role(request, pk, user_id):
    """Изменить роль участника."""
    team = get_object_or_404(Team, pk=pk)
    if not _can_manage_team(request.user, team):
        return JsonResponse({'error': 'Нет прав'}, status=403)

    try:
        data = json.loads(request.body)
        new_role = data.get('role')
        if new_role not in [r[0] for r in TeamMemberRole.choices]:
            return JsonResponse({'error': 'Неверная роль'}, status=400)

        membership = get_object_or_404(TeamMember, team=team, user_id=user_id)
        if membership.role == TeamMemberRole.OWNER:
            return JsonResponse({'error': 'Нельзя изменить роль владельца'}, status=400)
        if new_role == TeamMemberRole.OWNER:
            return JsonResponse({'error': 'Нельзя назначить владельцем'}, status=400)

        membership.role = new_role
        membership.save()
        return JsonResponse({'success': True, 'role': new_role})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


# =============================================================================
# ADD TEAM TO PROJECT
# =============================================================================

@login_required
@require_POST
def add_team_to_project(request, project_pk, team_pk):
    """Добавить всех участников команды в проект с указанной ролью."""
    project = get_object_or_404(Project, pk=project_pk)
    team = get_object_or_404(Team, pk=team_pk)

    if not ProjectPermissions.can_manage_members(request.user, project):
        return JsonResponse({'error': 'Нет прав управлять участниками проекта'}, status=403)
    if not _can_view_team(request.user, team):
        return JsonResponse({'error': 'Нет доступа к команде'}, status=403)

    try:
        data = json.loads(request.body)
        role = data.get('role', ProjectMemberRole.MEMBER)
        if role not in [r[0] for r in ProjectMemberRole.choices]:
            role = ProjectMemberRole.MEMBER

        added = 0
        for tm in team.members.select_related('user'):
            _, created = ProjectMember.objects.get_or_create(
                project=project,
                user=tm.user,
                defaults={'role': role, 'invited_by': request.user},
            )
            if created:
                added += 1

        return JsonResponse({'success': True, 'added': added})
    except Exception as e:
        logger.exception(e)
        return JsonResponse({'error': str(e)}, status=500)
