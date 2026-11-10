import importlib.util
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest

try:
    import psutil
except ImportError:
    psutil = None

ROOT = Path(__file__).resolve().parents[1]


@unittest.skipIf(psutil is None, "requires Windows deployment requirements")
class WindowsServicesTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("windows_services", ROOT / "scripts/windows/manage.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.module.ROOT = Path(self.temporary.name)
        self.module.STATE = self.module.ROOT / "runtime/windows-services.json"

    def test_stale_pid_record_never_stops_unrelated_process(self):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        try:
            process = psutil.Process(child.pid)
            record = {"pid": child.pid, "created": process.create_time() - 10, "argv": process.cmdline()}
            self.module.stop_record(record)
            self.assertIsNone(child.poll())
            record["created"] = process.create_time()
            record["argv"] = ["unrelated.exe"]
            self.module.stop_record(record)
            self.assertIsNone(child.poll())
        finally:
            child.terminate()
            child.wait(timeout=5)

    def test_occupied_port_does_not_start_or_stop_anything(self):
        with socket.socket() as server:
            server.bind(("127.0.0.1", 0))
            server.listen()
            records = {}
            with self.assertRaisesRegex(RuntimeError, "already occupied"):
                self.module.start_one("test", ["does-not-exist"], {}, records, server.getsockname()[1])
            self.assertEqual(records, {})
            self.assertTrue(self.module.listening(server.getsockname()[1]))

    def test_duplicate_start_reuses_owned_child_and_stop_cleans_it(self):
        records = {}
        argv = [sys.executable, "-c", "import time; time.sleep(60)"]
        import os
        try:
            self.assertTrue(self.module.start_one("test", argv, os.environ.copy(), records))
            pid = records["test"]["pid"]
            self.assertFalse(self.module.start_one("test", argv, os.environ.copy(), records))
            self.assertEqual(records["test"]["pid"], pid)
        finally:
            self.module.stop_record(records.get("test"))
        self.assertIsNone(self.module.owned_process(records.get("test")))


if __name__ == "__main__":
    unittest.main()
