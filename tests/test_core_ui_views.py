import pytest
import asyncio
from django.contrib.auth.models import User
from servers.models import Server
from core_ui.views import _get_server_names_for_user

@pytest.mark.django_db
@pytest.mark.asyncio
async def test_get_server_names_for_user_happy_path():
    """Verify that the function returns a list of server names belonging to the user."""
    from asgiref.sync import sync_to_async
    user = await sync_to_async(User.objects.create_user)(username="user1", password="pw")
    await sync_to_async(Server.objects.create)(name="server_one", user_id=user.id, host="127.0.0.1", port=22)
    await sync_to_async(Server.objects.create)(name="server_two", user_id=user.id, host="127.0.0.1", port=22)

    names = await _get_server_names_for_user(user.id)
    assert sorted(names) == ["server_one", "server_two"]

@pytest.mark.django_db
@pytest.mark.asyncio
async def test_get_server_names_for_user_empty():
    """Verify that the function returns an empty list if the user has no servers."""
    from asgiref.sync import sync_to_async
    user = await sync_to_async(User.objects.create_user)(username="user2", password="pw")

    names = await _get_server_names_for_user(user.id)
    assert names == []

@pytest.mark.django_db
@pytest.mark.asyncio
async def test_get_server_names_for_user_isolation():
    """Verify that the function doesn't return other users' servers."""
    from asgiref.sync import sync_to_async
    user1 = await sync_to_async(User.objects.create_user)(username="user_a", password="pw")
    user2 = await sync_to_async(User.objects.create_user)(username="user_b", password="pw")

    await sync_to_async(Server.objects.create)(name="server_a", user_id=user1.id, host="127.0.0.1", port=22)
    await sync_to_async(Server.objects.create)(name="server_b", user_id=user2.id, host="127.0.0.1", port=22)

    names1 = await _get_server_names_for_user(user1.id)
    assert sorted(names1) == ["server_a"]

    names2 = await _get_server_names_for_user(user2.id)
    assert sorted(names2) == ["server_b"]

@pytest.mark.django_db
@pytest.mark.asyncio
async def test_get_server_names_for_user_invalid_user_id():
    """Verify that the function handles a non-existent user gracefully (returns empty list)."""
    # Assuming user ID 99999 does not exist
    names = await _get_server_names_for_user(99999)
    assert names == []
