import pytest
from core_ui.views import _load_session
from core_ui.models import ChatSession

@pytest.mark.django_db
def test_load_session_success(django_user_model):
    """Test loading an existing chat session for the correct user."""
    user = django_user_model.objects.create_user(username='testuser', password='password')
    session = ChatSession.objects.create(user=user, title="Test Session")

    loaded_session = _load_session(user.id, session.id)

    assert loaded_session is not None
    assert loaded_session.id == session.id
    assert loaded_session.user_id == user.id

@pytest.mark.django_db
def test_load_session_wrong_user(django_user_model):
    """Test that a user cannot load another user's chat session."""
    user1 = django_user_model.objects.create_user(username='testuser1', password='password')
    user2 = django_user_model.objects.create_user(username='testuser2', password='password')

    session = ChatSession.objects.create(user=user1, title="User 1 Session")

    # Try to load user1's session using user2's ID
    loaded_session = _load_session(user2.id, session.id)

    assert loaded_session is None

@pytest.mark.django_db
def test_load_session_not_found(django_user_model):
    """Test loading a non-existent chat session."""
    user = django_user_model.objects.create_user(username='testuser', password='password')

    loaded_session = _load_session(user.id, 99999)

    assert loaded_session is None

@pytest.mark.django_db
def test_load_session_invalid_chat_id(django_user_model):
    """Test loading a chat session with an invalid chat ID (e.g., string instead of int)."""
    user = django_user_model.objects.create_user(username='testuser', password='password')

    # Passing a string that can't be converted to an int might raise ValueError or TypeError in Django's ORM
    with pytest.raises(ValueError):
        _load_session(user.id, "invalid_id")

@pytest.mark.django_db
def test_load_session_invalid_user_id(django_user_model):
    """Test loading a chat session with an invalid user ID."""
    # Create a session just so there is something in the DB
    user = django_user_model.objects.create_user(username='testuser', password='password')
    session = ChatSession.objects.create(user=user, title="Test Session")

    with pytest.raises(ValueError):
        _load_session("invalid_user_id", session.id)
