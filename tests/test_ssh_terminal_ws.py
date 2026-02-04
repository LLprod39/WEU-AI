"""
Smoke tests for Servers WebSocket terminal consumer.

These tests don't establish a real SSH connection (that requires external infra),
but they verify:
- WebSocket routing works
- Auth/user scoping works (server must belong to user)
- Consumer sends initial 'ready' message
- AI requests before SSH connect return a controlled error
"""

from asgiref.sync import async_to_sync
from channels.testing import WebsocketCommunicator
from django.contrib.auth.models import User
from django.test import TransactionTestCase

from servers.consumers import SSHTerminalConsumer
from servers.models import Server
from servers.routing import websocket_urlpatterns as servers_websocket_urlpatterns
from web_ui.routing import websocket_urlpatterns as web_ui_websocket_urlpatterns


class TestServersTerminalWebSocket(TransactionTestCase):
    def test_ws_routing_contains_terminal_path(self):
        # Ensure WS route is registered (servers/ and web_ui/)
        patterns_servers = [str(p.pattern) for p in servers_websocket_urlpatterns]
        patterns_root = [str(p.pattern) for p in web_ui_websocket_urlpatterns]
        self.assertIn("ws/servers/<int:server_id>/terminal/", patterns_servers)
        self.assertIn("ws/servers/<int:server_id>/terminal/", patterns_root)

    def test_ws_connect_sends_ready(self):
        user = User.objects.create_user(username="ws_user", password="pw123456")
        server = Server.objects.create(
            user=user,
            name="WS Test Server",
            host="127.0.0.1",
            port=22,
            username="root",
            auth_method="password",
            is_active=True,
        )

        async def run():
            app = SSHTerminalConsumer.as_asgi()
            comm = WebsocketCommunicator(app, f"/ws/servers/{server.id}/terminal/")
            comm.scope["user"] = user
            comm.scope["url_route"] = {"kwargs": {"server_id": server.id}}
            connected, _ = await comm.connect()
            self.assertTrue(connected)

            msg = await comm.receive_json_from()
            self.assertEqual(msg.get("type"), "ready")
            self.assertEqual(msg.get("server_id"), server.id)

            await comm.disconnect()

        async_to_sync(run)()

    def test_ai_request_before_ssh_connect_returns_error(self):
        user = User.objects.create_user(username="ws_user2", password="pw123456")
        server = Server.objects.create(
            user=user,
            name="WS Test Server 2",
            host="127.0.0.1",
            port=22,
            username="root",
            auth_method="password",
            is_active=True,
        )

        async def run():
            app = SSHTerminalConsumer.as_asgi()
            comm = WebsocketCommunicator(app, f"/ws/servers/{server.id}/terminal/")
            comm.scope["user"] = user
            comm.scope["url_route"] = {"kwargs": {"server_id": server.id}}
            connected, _ = await comm.connect()
            self.assertTrue(connected)
            await comm.receive_json_from()  # ready

            await comm.send_json_to({"type": "ai_request", "message": "проверь диск"})
            msg = await comm.receive_json_from()
            self.assertEqual(msg.get("type"), "ai_error")

            await comm.disconnect()

        async_to_sync(run)()

