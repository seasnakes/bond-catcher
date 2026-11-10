import os
from pathlib import Path
import subprocess
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from process_utils import process_alive


class ProcessCheckTests(unittest.TestCase):
    def test_liveness_does_not_stop_child(self):
        child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        try:
            for _ in range(10):
                self.assertTrue(process_alive(child.pid))
                self.assertIsNone(child.poll())
        finally:
            child.terminate()
            child.wait(timeout=5)
        self.assertFalse(process_alive(child.pid))

    def test_invalid_pid_and_current_process(self):
        self.assertFalse(process_alive(0))
        self.assertFalse(process_alive(-1))
        self.assertTrue(process_alive(os.getpid()))


if __name__ == "__main__":
    unittest.main()
