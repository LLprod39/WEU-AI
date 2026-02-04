"""
WebSocket routes for servers app.

Filled in as consumers are implemented.
"""

from django.urls import path

from servers.consumers import SSHTerminalConsumer


websocket_urlpatterns = [
    path("ws/servers/<int:server_id>/terminal/", SSHTerminalConsumer.as_asgi()),
]

