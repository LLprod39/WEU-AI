"""
Management command: run_scheduled_pipelines

Polls PipelineTrigger records with trigger_type='schedule' and fires those
whose cron expression indicates it's time to run.

Usage:
    python manage.py run_scheduled_pipelines --interval 60

Run as a persistent daemon:
    python manage.py run_scheduled_pipelines --daemon
"""

import asyncio
import time

from croniter import croniter
from django.core.management.base import BaseCommand
from django.utils import timezone

from studio.models import PipelineRun, PipelineTrigger


class Command(BaseCommand):
    help = "Poll and fire scheduled pipeline triggers"

    def add_arguments(self, parser):
        parser.add_argument(
            "--interval",
            type=int,
            default=60,
            help="Poll interval in seconds (default: 60)",
        )
        parser.add_argument(
            "--daemon",
            action="store_true",
            help="Run continuously until interrupted",
        )
        parser.add_argument(
            "--once",
            action="store_true",
            help="Run once and exit (for cron job wrappers)",
        )

    def handle(self, *args, **options):
        interval = options["interval"]
        daemon = options["daemon"]
        once = options["once"]

        self.stdout.write("Starting pipeline scheduler...")
        if once or not daemon:
            self._tick()
        else:
            while True:
                self._tick()
                self.stdout.write(f"Next check in {interval}s...")
                time.sleep(interval)

    def _tick(self):
        now = timezone.now()
        triggers = PipelineTrigger.objects.select_related("pipeline").filter(
            trigger_type=PipelineTrigger.TYPE_SCHEDULE,
            is_active=True,
        )
        for trigger in triggers:
            if not trigger.cron_expression:
                continue
            try:
                cron = croniter(trigger.cron_expression, trigger.last_triggered_at or now)
                next_run = cron.get_next(float)
                # If next_run is in the past (or now), it's time to fire
                from datetime import datetime, timezone as dt_tz

                next_run_dt = datetime.fromtimestamp(next_run, tz=dt_tz.utc)
                if next_run_dt <= now:
                    self._fire_trigger(trigger)
            except Exception as exc:
                self.stderr.write(f"Error evaluating trigger #{trigger.pk}: {exc}")

    def _fire_trigger(self, trigger: PipelineTrigger):
        from studio.views import _launch_pipeline_run_async

        run = PipelineRun.objects.create(
            pipeline=trigger.pipeline,
            trigger=trigger,
            status=PipelineRun.STATUS_PENDING,
            trigger_data={"source": "schedule", "cron": trigger.cron_expression},
        )
        trigger.last_triggered_at = timezone.now()
        trigger.save(update_fields=["last_triggered_at"])
        _launch_pipeline_run_async(run)
        self.stdout.write(f"Fired trigger #{trigger.pk} ({trigger.pipeline.name}) → run #{run.pk}")
