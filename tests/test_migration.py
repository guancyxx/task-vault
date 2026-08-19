import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

from scripts.migrate_legacy_tasks import parse_legacy_file


ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / "tests" / "migrate_corpus"


class MigrationTest(unittest.TestCase):
    def test_fixture_snapshot_and_completed_line_is_skipped(self):
        source = CORPUS / "legacy" / "2026-08-18.md"
        expected = json.loads((CORPUS / "expected.json").read_text(encoding="utf-8"))
        parsed = parse_legacy_file(source)
        self.assertEqual(len(parsed), 2)
        actual = []
        for item in parsed:
            snapshot = {key: item.frontmatter.get(key) for key in expected[len(actual)] if key not in {"execution_contains", "doubts"}}
            if "execution_contains" in expected[len(actual)]:
                snapshot["execution_contains"] = expected[len(actual)]["execution_contains"]
                self.assertIn(snapshot["execution_contains"], item.body)
            if "doubts" in expected[len(actual)]:
                snapshot["doubts"] = item.doubts
            actual.append(snapshot)
        self.assertEqual(actual, expected)

    def test_dry_run_reports_without_writes(self):
        with tempfile.TemporaryDirectory() as temporary:
            tasks = Path(temporary) / "03 Tasks"
            tasks.mkdir(parents=True)
            source = tasks / "2026-08-18.md"
            source.write_bytes((CORPUS / "legacy" / "2026-08-18.md").read_bytes())
            result = subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "migrate_legacy_tasks.py"), "--tasks-dir", str(tasks), "--dry-run"],
                check=True,
                capture_output=True,
                text=True,
            )
            self.assertIn("2026-08-18.md:3", result.stdout)
            self.assertIn("疑点", result.stdout)
            self.assertEqual(list(tasks.glob("*.md")), [source])
            self.assertFalse((tasks / "_archive").exists())

    def test_apply_writes_tasks_and_archives_identical_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            tasks = Path(temporary) / "03 Tasks"
            tasks.mkdir(parents=True)
            source = tasks / "2026-08-18.md"
            original = (CORPUS / "legacy" / "2026-08-18.md").read_bytes()
            source.write_bytes(original)
            subprocess.run(
                [sys.executable, str(ROOT / "scripts" / "migrate_legacy_tasks.py"), "--tasks-dir", str(tasks), "--apply"],
                check=True,
                capture_output=True,
                text=True,
            )
            archive = tasks / "_archive" / source.name
            self.assertEqual(hashlib.sha256(archive.read_bytes()).digest(), hashlib.sha256(original).digest())
            self.assertFalse(source.exists())
            generated = sorted(p for p in tasks.rglob("*.md") if "_archive" not in p.relative_to(tasks).parts)
            self.assertEqual(len(generated), 2)
            metadata = []
            for path in generated:
                text = path.read_text(encoding="utf-8")
                metadata.append(yaml.safe_load(text.split("---", 2)[1]))
            self.assertTrue(all(item["id"] for item in metadata))


if __name__ == "__main__":
    unittest.main()
