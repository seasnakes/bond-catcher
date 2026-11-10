"""Verify a freshly extracted private migration package before starting it."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--kind", choices=["all", "program", "data"], default="all")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    failed = []
    checked = 0
    for kind in (["program", "data"] if args.kind == "all" else [args.kind]):
        manifest = json.loads((root / f"release-{kind}.json").read_text(encoding="utf-8"))
        for name, expected in manifest["files"].items():
            file = (root / name).resolve()
            if not file.is_relative_to(root) or not file.is_file():
                failed.append(name)
                continue
            h = hashlib.sha256()
            with file.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    h.update(block)
            if file.stat().st_size != expected["bytes"] or h.hexdigest() != expected["sha256"]:
                failed.append(name)
            checked += 1
    print(json.dumps({"files_checked": checked, "failures": failed}, ensure_ascii=False))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
