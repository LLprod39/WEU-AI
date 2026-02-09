from django.core.management.base import BaseCommand

from skills.services import SkillService


class Command(BaseCommand):
    help = "Sync skills from git sources for records with auto_sync_enabled=true"

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args, **options):
        limit = int(options.get("limit") or 100)
        result = SkillService.sync_due_skills(limit=limit)
        self.stdout.write(
            self.style.SUCCESS(
                f"checked={result['checked']} synced={result['synced']} failed={result['failed']}"
            )
        )
