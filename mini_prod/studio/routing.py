from django.urls import path

from .consumers import PipelineRunConsumer

websocket_urlpatterns = [
    path("ws/studio/pipeline-runs/<int:run_id>/live/", PipelineRunConsumer.as_asgi()),
]
