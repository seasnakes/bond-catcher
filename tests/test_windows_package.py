import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("package_builder", ROOT / "scripts/build-windows-package.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PackageTests(unittest.TestCase):
    def test_online_backup_includes_committed_wal_data_and_leaves_source_intact(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "active.sqlite3"
            target = Path(folder) / "backup/copy.sqlite3"
            connection = sqlite3.connect(source)
            try:
                connection.execute("PRAGMA journal_mode=WAL")
                connection.execute("CREATE TABLE observations (value INTEGER)")
                connection.execute("INSERT INTO observations VALUES (42)")
                connection.commit()
                builder.snapshot_file(source, target)
                with closing(sqlite3.connect(target)) as backup:
                    self.assertEqual(backup.execute("SELECT value FROM observations").fetchone()[0], 42)
                    self.assertEqual(backup.execute("PRAGMA quick_check").fetchone()[0], "ok")
                self.assertEqual(connection.execute("SELECT COUNT(*) FROM observations").fetchone()[0], 1)
            finally:
                connection.close()

    def test_copy_skips_live_sidecars_logs_and_temporary_files(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "source"
            source.mkdir()
            for name in ["cache.json", "worker.log", "data.sqlite3-wal", "data.sqlite3-shm", "file.tmp"]:
                (source / name).write_text("{}");
            target = Path(folder) / "backup"
            builder.copy_item(source, target)
            self.assertEqual([p.name for p in target.iterdir()], ["cache.json"])


if __name__ == "__main__":
    unittest.main()
