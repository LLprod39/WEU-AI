"""
WebSocket consumer for Pipeline Run live updates.

Channel group: pipeline_run_{run_id}
URL: /ws/studio/pipeline-runs/<run_id>/live/
"""

from __future__ import annotations

import json

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.contrib.auth.models import AnonymousUser
from django.core.serializers.json import DjangoJSONEncoder


class PipelineRunConsumer(AsyncWebsocketConsumer):
    async def _send_event(self, payload: dict):
        await self.send(text_data=json.dumps(payload, cls=DjangoJSONEncoder, ensure_ascii=False))

    async def connect(self):
        user = self.scope.get("user")
        if not user or isinstance(user, AnonymousUser) or not user.is_authenticated:
            await self.close(code=4001)
            return
        if not await self._user_can_studio(user.id):
            await self.close(code=4003)
            return

        run_id = self.scope["url_route"]["kwargs"]["run_id"]
        self.run_id = run_id
        self.group_name = f"pipeline_run_{run_id}"

        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, code):
        if hasattr(self, "group_name"):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data:
            return
        try:
            msg = json.loads(text_data)
        except json.JSONDecodeError:
            return

        action = msg.get("action")
        if action == "stop":
            from asgiref.sync import sync_to_async

            from studio.models import PipelineRun

            run = await sync_to_async(PipelineRun.objects.get)(pk=self.run_id)
            # Signal executor to stop (stored in channels group metadata)
            await self.channel_layer.group_send(
                self.group_name,
                {"type": "pipeline.control", "action": "stop"},
            )

    # ------------------------------------------------------------------
    # Handlers for group messages
    # ------------------------------------------------------------------

    async def pipeline_node_event(self, event):
        await self._send_event({"type": "node_event", **event})

    async def pipeline_node_state(self, event):
        await self._send_event({"type": "node_state", **event})

    async def pipeline_status(self, event):
        await self._send_event({"type": "run_status", **event})

    async def pipeline_control(self, event):
        # Forwarded to all consumers in the group (including executor task)
        pass

    @database_sync_to_async
    def _user_can_studio(self, user_id: int) -> bool:
        from django.contrib.auth.models import User
        from core_ui.context_processors import user_can_feature

        user = User.objects.filter(id=user_id).first()
        return bool(user and user_can_feature(user, "agents"))
