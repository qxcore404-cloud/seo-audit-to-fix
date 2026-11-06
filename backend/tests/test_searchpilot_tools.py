import asyncio
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app import main


class SearchPilotToolTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.demo_file = Path(self.temp_dir.name) / "index.html"
        self.demo_file.write_text(
            "<!doctype html><html><head><title>Old</title>"
            "<meta name='description' content='Old description'></head>"
            "<body><h1>Demo</h1></body></html>",
            encoding="utf-8",
        )
        self.file_patch = patch.object(main, "_DEMO_FILE", self.demo_file)
        self.file_patch.start()

    def tearDown(self):
        self.file_patch.stop()
        self.temp_dir.cleanup()

    def test_agent_tool_routes_are_separate_from_approval(self):
        paths = {route.path for route in main.app.routes}
        self.assertIn("/api/tools/audit_website", paths)
        self.assertIn("/api/tools/create_fix_preview", paths)
        self.assertIn("/api/tools/verify_demo_fix", paths)
        self.assertIn("/api/tools/get_fix_history", paths)
        self.assertNotIn("/api/tools/approve", paths)

    def test_audit_tool_scans_without_writing(self):
        original = self.demo_file.read_text(encoding="utf-8")

        async def fake_download(_url):
            return "<html><head><title>Example title long enough to pass</title></head><body><h1>Example</h1></body></html>"

        async def inline_to_thread(function, *args):
            return function(*args)

        with patch.object(main, "download_html", fake_download), patch.object(
            main.asyncio, "to_thread", inline_to_thread
        ):
            result = asyncio.run(main.tool_audit_website(
                main.AuditRequest(url="https://example.com")
            ))
        self.assertEqual(result["url"], "https://example.com/")
        self.assertGreater(result["summary"]["total"], 0)
        self.assertEqual(self.demo_file.read_text(encoding="utf-8"), original)

    def test_preview_does_not_write_and_human_token_is_required(self):
        original = self.demo_file.read_text(encoding="utf-8")
        with patch.dict(os.environ, {"SEARCHPILOT_HUMAN_APPROVAL_TOKEN": "human-only-test-token"}):
            preview = main.tool_create_fix_preview(main.FixPreviewRequest(
                issue_type="title", proposed_value="A better demo title"
            ))
            self.assertTrue(preview["approval_required"])
            self.assertIn("A better demo title", preview["preview_html"])
            self.assertEqual(self.demo_file.read_text(encoding="utf-8"), original)

            request = main.FixApproveRequest(preview_id=preview["preview_id"], approved=True)
            with self.assertRaises(HTTPException) as denied:
                main.approve_seo_fix(request, None)
            self.assertEqual(denied.exception.status_code, 403)
            self.assertEqual(self.demo_file.read_text(encoding="utf-8"), original)

            applied = main.approve_seo_fix(request, "human-only-test-token")
            self.assertTrue(applied["applied"])
            self.assertIn("A better demo title", self.demo_file.read_text(encoding="utf-8"))
            self.assertEqual(main.tool_verify_demo_fix()["audit"]["url"], "http://searchpilot-demo.local/")
            self.assertEqual(main.tool_get_fix_history()["history"][0]["status"], "Applied")

    def test_preview_has_no_public_write_destination(self):
        preview = main.tool_create_fix_preview(main.FixPreviewRequest(
            issue_type="meta_description", proposed_value="Demo-only change"
        ))
        self.assertEqual(preview["issue_type"], "meta_description")
        self.assertNotIn("url", preview)
        self.assertNotIn("Demo-only change", self.demo_file.read_text(encoding="utf-8"))

    def test_rejection_records_decision_without_applying(self):
        original = self.demo_file.read_text(encoding="utf-8")
        with patch.dict(os.environ, {"SEARCHPILOT_HUMAN_APPROVAL_TOKEN": "human-only-test-token"}):
            preview = main.tool_create_fix_preview(main.FixPreviewRequest(
                issue_type="title", proposed_value="Rejected change"
            ))
            result = main.approve_seo_fix(
                main.FixApproveRequest(preview_id=preview["preview_id"], approved=False),
                "human-only-test-token",
            )
        self.assertFalse(result["applied"])
        self.assertEqual(self.demo_file.read_text(encoding="utf-8"), original)
        self.assertEqual(main.tool_get_fix_history()["history"][0]["status"], "Rejected")


if __name__ == "__main__":
    unittest.main()
