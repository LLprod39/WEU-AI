"""
Тесты для app.utils.disk_usage и GET /api/disk/.

Проверяют:
- get_disk_usage: существующий путь, отсутствующий путь, ошибки доступа без падения.
- get_disk_usage_report: только root, смешанные пути (существующие и отсутствующие), без падения.
- GET /api/disk/: JSON с paths (root, base_dir, media_root, agent_projects_dir), поля total, used,
  free, percent_used и при успехе total_human, used_human, free_human.
"""
from pathlib import Path

from django.test import TestCase, Client
from django.contrib.auth.models import User

from app.utils.disk_usage import get_disk_usage, get_disk_usage_report


class TestGetDiskUsage(TestCase):
    """Тесты get_disk_usage."""

    def test_existing_path_returns_stats(self):
        """Существующий путь возвращает total, used, free, percent_used без error."""
        result = get_disk_usage("/")
        self.assertIn("path", result)
        self.assertTrue(result["path"])
        self.assertNotIn("error", result)
        self.assertIsNotNone(result.get("total"))
        self.assertIsNotNone(result.get("used"))
        self.assertIsNotNone(result.get("free"))
        self.assertIsNotNone(result.get("percent_used"))
        self.assertGreaterEqual(result["percent_used"], 0)
        self.assertLessEqual(result["percent_used"], 100)

    def test_nonexistent_path_returns_error_no_crash(self):
        """Отсутствующий путь возвращает error, не падает."""
        result = get_disk_usage("/nonexistent_path_that_does_not_exist_12345")
        self.assertIn("error", result)
        self.assertIsNone(result.get("total"))
        self.assertIsNone(result.get("percent_used"))

    def test_nonexistent_path_as_path_object(self):
        """Path-объект несуществующего пути обрабатывается так же."""
        result = get_disk_usage(Path("/nonexistent_xyz_98765"))
        self.assertIn("error", result)
        self.assertIsNone(result.get("total"))

    def test_result_has_required_keys(self):
        """Результат всегда содержит ключи path, total, used, free, percent_used."""
        for path in ["/", "/nonexistent_abc"]:
            result = get_disk_usage(path)
            self.assertIn("path", result)
            self.assertIn("total", result)
            self.assertIn("used", result)
            self.assertIn("free", result)
            self.assertIn("percent_used", result)


class TestGetDiskUsageReport(TestCase):
    """Тесты get_disk_usage_report."""

    def test_only_root_no_crash(self):
        """Только include_root=True, остальные None — отчёт из одной записи (root), без падения."""
        report = get_disk_usage_report(
            include_root=True,
            media_root=None,
            uploaded_files_dir=None,
            agent_projects_dir=None,
            base_dir=None,
        )
        self.assertIsInstance(report, list)
        self.assertGreaterEqual(len(report), 1)
        first = report[0]
        self.assertEqual(first.get("label"), "root")
        self.assertIn("path", first)
        self.assertIn("total", first)
        self.assertIn("used", first)
        self.assertIn("free", first)
        self.assertIn("percent_used", first)

    def test_all_none_except_root(self):
        """Все опциональные пути None — возвращается только root."""
        report = get_disk_usage_report(
            include_root=True,
            base_dir=None,
            media_root=None,
            uploaded_files_dir=None,
            agent_projects_dir=None,
        )
        labels = [e.get("label") for e in report]
        self.assertIn("root", labels)
        self.assertEqual(report[0]["label"], "root")

    def test_mixed_existing_and_nonexistent_no_crash(self):
        """Смесь существующего (root/base_dir) и несуществующего пути — без падения."""
        base = Path(__file__).resolve().parent
        report = get_disk_usage_report(
            include_root=True,
            base_dir=base,
            media_root=None,
            uploaded_files_dir=None,
            agent_projects_dir=Path("/nonexistent_agent_projects_xyz"),
        )
        self.assertIsInstance(report, list)
        self.assertGreaterEqual(len(report), 2)
        for entry in report:
            self.assertIn("path", entry)
            self.assertIn("total", entry)
            self.assertIn("used", entry)
            self.assertIn("free", entry)
            self.assertIn("percent_used", entry)

    def test_include_root_false(self):
        """include_root=False — root не добавляется."""
        report = get_disk_usage_report(
            include_root=False,
            base_dir=None,
            media_root=None,
            uploaded_files_dir=None,
            agent_projects_dir=None,
        )
        self.assertEqual(report, [])


class TestApiDiskUsage(TestCase):
    """Тесты GET /api/disk/. Требуется пользователь с доступом к settings (staff)."""

    def setUp(self):
        self.client = Client()
        self.admin = User.objects.create_superuser(
            username="admin_disk",
            email="admin_disk@example.com",
            password="adminpassword123",
        )
        self.client.login(username="admin_disk", password="adminpassword123")

    def test_api_disk_returns_json_with_paths(self):
        """GET /api/disk/ возвращает JSON с ключом paths (список)."""
        response = self.client.get("/api/disk/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("paths", data)
        self.assertIsInstance(data["paths"], list)

    def test_api_disk_paths_have_required_fields(self):
        """Каждая запись в paths содержит path, total, used, free, percent_used."""
        response = self.client.get("/api/disk/")
        self.assertEqual(response.status_code, 200)
        paths = response.json()["paths"]
        required = {"path", "total", "used", "free", "percent_used"}
        for entry in paths:
            for key in required:
                self.assertIn(key, entry, f"missing key {key} in {entry}")

    def test_api_disk_success_entries_have_human_fields(self):
        """Записи без error содержат total_human, used_human, free_human."""
        response = self.client.get("/api/disk/")
        self.assertEqual(response.status_code, 200)
        paths = response.json()["paths"]
        for entry in paths:
            if "error" not in entry:
                self.assertIn("total_human", entry)
                self.assertIn("used_human", entry)
                self.assertIn("free_human", entry)

    def test_api_disk_includes_expected_labels(self):
        """В paths присутствуют метки root, base_dir, media_root, agent_projects_dir."""
        response = self.client.get("/api/disk/")
        self.assertEqual(response.status_code, 200)
        paths = response.json()["paths"]
        labels = [p.get("label") for p in paths if p.get("label")]
        self.assertIn("root", labels)
        self.assertIn("base_dir", labels)
        self.assertIn("media_root", labels)
        self.assertIn("agent_projects_dir", labels)

    def test_api_disk_requires_auth(self):
        """Неавторизованный запрос к /api/disk/ возвращает редирект или 403."""
        client_anon = Client()
        response = client_anon.get("/api/disk/")
        self.assertIn(response.status_code, (302, 403))
