import re
import subprocess
import tempfile
from pathlib import Path
from typing import Iterable

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from loguru import logger

from skills.models import Skill, SkillSyncLog


class SkillService:
    @staticmethod
    def _normalize_skill_ids(skill_ids: Iterable[int] | None) -> list[int]:
        if not skill_ids:
            return []
        out: list[int] = []
        for raw in skill_ids:
            try:
                sid = int(raw)
            except (TypeError, ValueError):
                continue
            if sid > 0 and sid not in out:
                out.append(sid)
        return out

    @staticmethod
    def _base_scope_filter(user) -> Q:
        if not user or not getattr(user, "is_authenticated", False):
            return Q(pk__in=[])
        return Q(owner=user) | Q(shares__shared_with=user)

    @staticmethod
    def can_view_skill(user, skill: Skill) -> bool:
        if not user or not getattr(user, "is_authenticated", False):
            return False
        if skill.owner_id == user.id:
            return True
        return skill.shares.filter(shared_with=user).exists()

    @staticmethod
    def can_edit_skill(user, skill: Skill) -> bool:
        if not user or not getattr(user, "is_authenticated", False):
            return False
        if skill.owner_id == user.id:
            return True
        return skill.shares.filter(shared_with=user, can_edit=True).exists()

    @staticmethod
    def can_manage_skill(user, skill: Skill) -> bool:
        if not user or not getattr(user, "is_authenticated", False):
            return False
        if skill.owner_id == user.id:
            return True
        return skill.shares.filter(shared_with=user, can_manage=True).exists()

    @staticmethod
    def get_skills_for_context(
        user,
        skill_ids: Iterable[int] | None,
        channel: str,
        runtime: str | None = None,
    ) -> list[Skill]:
        ids = SkillService._normalize_skill_ids(skill_ids)
        qs = Skill.objects.filter(SkillService._base_scope_filter(user), is_active=True)

        if ids:
            qs = qs.filter(id__in=ids)
        else:
            channel = (channel or "chat").strip().lower()
            channel_filter = {
                "chat": Q(auto_apply_chat=True),
                "agent": Q(auto_apply_agents=True),
                "workflow": Q(auto_apply_workflows=True),
            }.get(channel, Q(auto_apply_chat=True))
            qs = qs.filter(channel_filter, status=Skill.STATUS_PROD)

        skills = list(qs.distinct().order_by("owner_id", "name"))
        if runtime:
            skills = [s for s in skills if s.supports_runtime(runtime)]
        return skills

    @staticmethod
    def build_skill_context(
        user,
        skill_ids: Iterable[int] | None,
        channel: str,
        runtime: str | None = None,
        include_references: bool = True,
    ) -> dict:
        skills = SkillService.get_skills_for_context(user, skill_ids, channel=channel, runtime=runtime)
        blocks = []

        global_rules = (getattr(settings, "SKILLS_GLOBAL_RULES", "") or "").strip()
        if global_rules:
            blocks.append("# Global Policy\n" + global_rules)

        for skill in skills:
            blocks.append(skill.render_compact(include_references=include_references))

        text = "\n\n".join(b for b in blocks if b.strip())
        max_chars = int(getattr(settings, "SKILLS_MAX_CONTEXT_CHARS", 24000) or 24000)
        if len(text) > max_chars:
            text = text[:max_chars] + "\n\n[skill-context truncated]"

        return {
            "skills": skills,
            "skill_ids": [s.id for s in skills],
            "skill_names": [s.name for s in skills],
            "text": text,
        }

    @staticmethod
    def prepend_context(base_prompt: str, skill_context_text: str) -> str:
        skill_context_text = (skill_context_text or "").strip()
        if not skill_context_text:
            return base_prompt
        return f"=== SKILLS CONTEXT ===\n{skill_context_text}\n=== END SKILLS CONTEXT ===\n\n{base_prompt}"

    @staticmethod
    def sync_skill(skill: Skill, triggered_by: str = "manual") -> dict:
        try:
            if skill.source_type == Skill.SOURCE_MANUAL:
                skill.version += 1
                skill.last_synced_at = timezone.now()
                skill.last_sync_error = ""
                skill.save(update_fields=["version", "last_synced_at", "last_sync_error", "updated_at"])
                msg = f"Manual sync completed (v{skill.version})"
                SkillSyncLog.objects.create(skill=skill, success=True, message=msg, details={"trigger": triggered_by})
                return {"success": True, "message": msg}

            if skill.source_type != Skill.SOURCE_GIT:
                raise ValueError(f"Unsupported source_type: {skill.source_type}")

            url = (skill.source_url or "").strip()
            if not url:
                raise ValueError("source_url is required for git sync")

            ref = (skill.source_ref or "main").strip()
            source_path = (skill.source_path or "SKILL.md").strip().strip("/")

            with tempfile.TemporaryDirectory(prefix="weu-skill-sync-") as tmp:
                repo_dir = Path(tmp) / "repo"
                clone_cmd = [
                    "git",
                    "clone",
                    "--depth",
                    "1",
                    "--branch",
                    ref,
                    url,
                    str(repo_dir),
                ]
                proc = subprocess.run(clone_cmd, capture_output=True, text=True, timeout=120)
                if proc.returncode != 0:
                    stderr = (proc.stderr or "").strip()[:1500]
                    raise RuntimeError(f"git clone failed: {stderr}")

                target = repo_dir / source_path
                if target.is_dir():
                    skill_file = target / "SKILL.md"
                    references_dir = target / "references"
                else:
                    skill_file = target
                    references_dir = target.parent / "references"

                if not skill_file.exists():
                    raise FileNotFoundError(f"Skill file not found: {skill_file}")

                raw = skill_file.read_text(encoding="utf-8", errors="ignore")
                parsed = _parse_frontmatter(raw)

                references = []
                if references_dir.exists() and references_dir.is_dir():
                    for p in sorted(references_dir.glob("*.md"))[:20]:
                        content = p.read_text(encoding="utf-8", errors="ignore")[:5000]
                        references.append({"title": p.name, "content": content})

                if parsed.get("description"):
                    skill.description = parsed["description"]
                if parsed.get("name") and not skill.name:
                    skill.name = parsed["name"]

                body = parsed.get("body") or raw
                skill.instructions = body[:50000]
                skill.references = references
                skill.version += 1
                skill.last_synced_at = timezone.now()
                skill.last_sync_error = ""
                skill.save(
                    update_fields=[
                        "name",
                        "description",
                        "instructions",
                        "references",
                        "version",
                        "last_synced_at",
                        "last_sync_error",
                        "updated_at",
                    ]
                )

            msg = f"Git sync completed (v{skill.version})"
            SkillSyncLog.objects.create(
                skill=skill,
                success=True,
                message=msg,
                details={"trigger": triggered_by, "source_ref": ref, "source_path": source_path},
            )
            return {"success": True, "message": msg}

        except Exception as exc:
            err = str(exc)
            logger.warning(f"Skill sync failed for skill={skill.id}: {err}")
            skill.last_sync_error = err[:3000]
            skill.save(update_fields=["last_sync_error", "updated_at"])
            SkillSyncLog.objects.create(
                skill=skill,
                success=False,
                message="Sync failed",
                details={"error": err, "trigger": triggered_by},
            )
            return {"success": False, "error": err}

    @staticmethod
    def sync_due_skills(limit: int = 100) -> dict:
        now = timezone.now()
        synced = 0
        failed = 0
        checked = 0

        qs = Skill.objects.filter(
            is_active=True,
            source_type=Skill.SOURCE_GIT,
            auto_sync_enabled=True,
        ).order_by("last_synced_at")[:limit]

        for skill in qs:
            checked += 1
            should_sync = False
            if not skill.last_synced_at:
                should_sync = True
            else:
                delta = now - skill.last_synced_at
                should_sync = delta.total_seconds() >= max(skill.sync_interval_minutes, 1) * 60

            if not should_sync:
                continue

            result = SkillService.sync_skill(skill, triggered_by="auto")
            if result.get("success"):
                synced += 1
            else:
                failed += 1

        return {"checked": checked, "synced": synced, "failed": failed}


def _parse_frontmatter(raw_text: str) -> dict:
    text = raw_text or ""
    if not text.startswith("---\n"):
        return {"body": text}

    marker = "\n---\n"
    end_idx = text.find(marker, 4)
    if end_idx == -1:
        return {"body": text}

    header = text[4:end_idx]
    body = text[end_idx + len(marker) :]

    out = {"body": body}
    for line in header.splitlines():
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line.strip())
        if not m:
            continue
        key = m.group(1).strip().lower()
        val = m.group(2).strip().strip('"')
        out[key] = val
    return out
