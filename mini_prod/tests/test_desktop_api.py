import json

from django.contrib.auth.models import User
from django.test import Client, TestCase

from core_ui.managed_secrets import get_mcp_secret_env, get_server_auth_secret
from core_ui.models import ManagedSecret, UserAppPermission
from servers.models import Server
from studio.models import MCPServerPool


class DesktopApiTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.user = User.objects.create_user(
            username="desktop-user",
            email="desktop@example.com",
            password="StrongPass123!",
        )
        UserAppPermission.objects.update_or_create(
            user=self.user,
            feature="studio",
            defaults={"allowed": True},
        )

    def _login(self):
        response = self.client.post(
            "/api/desktop/v1/auth/login/",
            data=json.dumps({"username": "desktop-user", "password": "StrongPass123!", "device_name": "tests"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        payload = response.json()
        return payload["session"]["access_token"], payload["session"]["refresh_token"]

    def _auth_headers(self, access_token: str) -> dict:
        return {"HTTP_AUTHORIZATION": f"Bearer {access_token}"}

    def test_auth_refresh_and_me(self):
        access_token, refresh_token = self._login()

        me_response = self.client.get("/api/desktop/v1/auth/me/", **self._auth_headers(access_token))
        self.assertEqual(me_response.status_code, 200, me_response.content)
        self.assertEqual(me_response.json()["user"]["username"], "desktop-user")

        refresh_response = self.client.post(
            "/api/desktop/v1/auth/refresh/",
            data=json.dumps({"refresh_token": refresh_token}),
            content_type="application/json",
        )
        self.assertEqual(refresh_response.status_code, 200, refresh_response.content)
        self.assertIn("access_token", refresh_response.json()["session"])

    def test_server_create_uses_managed_secret_and_hides_plaintext(self):
        access_token, _ = self._login()
        response = self.client.post(
            "/api/desktop/v1/servers/",
            data=json.dumps(
                {
                    "name": "Prod SSH",
                    "host": "10.0.0.10",
                    "port": 22,
                    "username": "root",
                    "server_type": "ssh",
                    "auth_method": "password",
                    "password": "super-secret-password",
                    "notes": "desktop test",
                }
            ),
            content_type="application/json",
            **self._auth_headers(access_token),
        )
        self.assertEqual(response.status_code, 201, response.content)
        payload = response.json()["item"]
        self.assertTrue(payload["has_saved_secret"])
        self.assertNotIn("password", payload)

        server = Server.objects.get(name="Prod SSH")
        self.assertEqual(get_server_auth_secret(server.id), "super-secret-password")
        self.assertTrue(ManagedSecret.objects.filter(namespace="server_auth_secret", object_id=server.id).exists())

    def test_mcp_secret_env_is_masked_in_desktop_api(self):
        access_token, _ = self._login()
        response = self.client.post(
            "/api/desktop/v1/mcp/",
            data=json.dumps(
                {
                    "name": "GitHub MCP",
                    "transport": "stdio",
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {"LOG_LEVEL": "debug"},
                    "secret_env": {"GITHUB_TOKEN": "top-secret-token"},
                }
            ),
            content_type="application/json",
            **self._auth_headers(access_token),
        )
        self.assertEqual(response.status_code, 201, response.content)
        item = response.json()["item"]
        self.assertEqual(item["env"], {"LOG_LEVEL": "debug"})
        self.assertEqual(item["secret_env_keys"], ["GITHUB_TOKEN"])
        self.assertNotIn("top-secret-token", json.dumps(item))

        mcp = MCPServerPool.objects.get(name="GitHub MCP")
        self.assertEqual(get_mcp_secret_env(mcp.id), {"GITHUB_TOKEN": "top-secret-token"})

    def test_terminal_ws_ticket_uses_bearer_auth(self):
        access_token, _ = self._login()
        server = Server.objects.create(
            user=self.user,
            name="WS test",
            host="localhost",
            port=22,
            username="root",
            server_type="ssh",
            auth_method="password",
        )

        response = self.client.post(
            "/api/desktop/v1/terminal/ws-ticket/",
            data=json.dumps({"server_id": server.id}),
            content_type="application/json",
            **self._auth_headers(access_token),
        )
        self.assertEqual(response.status_code, 200, response.content)
        terminal = response.json()["terminal"]
        self.assertEqual(terminal["server_id"], server.id)
        self.assertIn("ws_token", terminal)
        self.assertIn(f"/ws/servers/{server.id}/terminal/", terminal["path"])
