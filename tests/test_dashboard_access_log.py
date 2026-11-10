from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from test_miniqmt_dashboard_api import load_dashboard_module


class DashboardAccessLogTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.module = load_dashboard_module(Path(self.temporary.name))

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def handler(self, path: str):
        handler = self.module.DashboardHandler.__new__(self.module.DashboardHandler)
        handler.path = path
        handler.command = "GET"
        handler.client_address = ("127.0.0.1", 50000)
        return handler

    def log(self, path: str, code: int) -> str:
        with mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
            self.handler(path).log_request(code)
        return stderr.getvalue()

    def test_successful_polling_requests_are_not_logged(self) -> None:
        self.assertEqual(self.log("/health", 200), "")
        self.assertEqual(self.log("/quotes?codes=600000.SH", 304), "")

    def test_errors_are_logged_without_query_parameters(self) -> None:
        line = self.log("/trading/orders?account=123456", 503)
        self.assertIn("GET /trading/orders 503", line)
        self.assertNotIn("123456", line)

    def test_access_log_can_be_enabled_for_debugging(self) -> None:
        with mock.patch.object(self.module, "ACCESS_LOG_ENABLED", True):
            self.assertIn("GET /health 200", self.log("/health", 200))


if __name__ == "__main__":
    unittest.main()
