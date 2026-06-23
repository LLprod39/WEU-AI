from unittest.mock import AsyncMock

from asgiref.sync import async_to_sync

from servers.rdp_consumer import RDPTerminalConsumer


class _DummyWriter:
    def __init__(self):
        self.writes = []

    def write(self, data: bytes) -> None:
        self.writes.append(data)

    async def drain(self) -> None:
        return None


def test_receive_proxies_client_instructions_when_guacd_is_ready():
    """
    Regression test: once guacd tunnel is established, client instructions like
    "sync"/input must be proxied immediately (without waiting for client
    "connect" instruction).
    """
    consumer = RDPTerminalConsumer()
    writer = _DummyWriter()
    consumer.guacd_writer = writer
    consumer._start_guacd = AsyncMock(side_effect=AssertionError("must not restart guacd"))

    async def run():
        await consumer.receive(text_data="4.sync,1.1;")

    async_to_sync(run)()

    consumer._start_guacd.assert_not_called()
    assert writer.writes == [b"4.sync,1.1;"]


def test_receive_bootstrap_json_then_proxies_guac_messages():
    consumer = RDPTerminalConsumer()
    writer = _DummyWriter()
    consumer.server = type(
        "S",
        (),
        {"auth_method": "password", "encrypted_password": "", "is_rdp": lambda self: True},
    )()
    consumer._resolve_password = AsyncMock(return_value="secret")

    async def fake_start(_password: str, _domain: str = "") -> None:
        consumer.guacd_writer = writer

    consumer._start_guacd = AsyncMock(side_effect=fake_start)

    async def run():
        await consumer.receive(text_data='{"master_password":"master"}')
        await consumer.receive(text_data="4.sync,1.1;")

    async_to_sync(run)()

    consumer._resolve_password.assert_awaited_once_with("master", "")
    consumer._start_guacd.assert_awaited_once_with("secret", "")
    assert writer.writes == [b"4.sync,1.1;"]


def test_receive_bootstrap_uses_explicit_rdp_password_and_domain():
    consumer = RDPTerminalConsumer()
    consumer.server = type(
        "S",
        (),
        {"auth_method": "password", "encrypted_password": "enc", "is_rdp": lambda self: True},
    )()
    consumer._resolve_password = AsyncMock(return_value="plain-secret")
    consumer._send_ws_error = AsyncMock()
    consumer._start_guacd = AsyncMock()

    async def run():
        await consumer.receive(text_data='{"master_password":"","password":"plain-secret","domain":"WORKGROUP"}')

    async_to_sync(run)()

    consumer._send_ws_error.assert_not_called()
    consumer._resolve_password.assert_awaited_once_with("", "plain-secret")
    consumer._start_guacd.assert_awaited_once_with("plain-secret", "WORKGROUP")


def test_receive_bootstrap_requires_credentials_for_encrypted_rdp_password():
    consumer = RDPTerminalConsumer()
    consumer.server = type(
        "S",
        (),
        {"auth_method": "password", "encrypted_password": "enc", "is_rdp": lambda self: True},
    )()
    consumer._resolve_password = AsyncMock()
    consumer._send_ws_error = AsyncMock()
    consumer._start_guacd = AsyncMock()

    async def run():
        await consumer.receive(text_data='{"master_password":"","password":""}')

    async_to_sync(run)()

    consumer._send_ws_error.assert_awaited_once()
    consumer._resolve_password.assert_not_called()
    consumer._start_guacd.assert_not_called()


def test_receive_bootstrap_reports_invalid_master_password():
    consumer = RDPTerminalConsumer()
    consumer.server = type(
        "S",
        (),
        {"auth_method": "password", "encrypted_password": "enc", "is_rdp": lambda self: True},
    )()
    consumer._resolve_password = AsyncMock(side_effect=ValueError("Invalid master password"))
    consumer._send_ws_error = AsyncMock()
    consumer._start_guacd = AsyncMock()

    async def run():
        await consumer.receive(text_data='{"master_password":"wrong","password":""}')

    async_to_sync(run)()

    consumer._send_ws_error.assert_awaited_once_with("Invalid master password", "invalid_master_password")
    consumer._start_guacd.assert_not_called()


def test_extract_guacd_error_from_single_chunk():
    consumer = RDPTerminalConsumer()
    msg, code = consumer._extract_guacd_error(
        b"5.error,45.Authentication failure (invalid credentials?),3.769;"
    )
    assert msg == "Authentication failure (invalid credentials?)"
    assert code == "769"


def test_extract_guacd_error_from_split_chunks():
    consumer = RDPTerminalConsumer()
    msg1, code1 = consumer._extract_guacd_error(
        b"5.error,45.Authentication failure (invalid cred"
    )
    assert msg1 is None
    assert code1 is None

    msg2, code2 = consumer._extract_guacd_error(b"entials?),3.769;")
    assert msg2 == "Authentication failure (invalid credentials?)"
    assert code2 == "769"
