#!/usr/bin/env python3
"""Run the migration fixture assertions without requiring pytest."""

import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


if __name__ == "__main__":
    suite = unittest.defaultTestLoader.discover("tests", pattern="test_migration.py")
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(not result.wasSuccessful())
