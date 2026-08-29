import json
import unittest
from pathlib import Path

from app.main import app


class OpenApiSnapshotTests(unittest.TestCase):
    def test_generated_contract_has_not_drifted(self):
        snapshot = Path("/docs/openapi.json")
        if not snapshot.exists():
            self.skipTest("/docs/openapi.json is mounted by the Compose test stack")
        expected = json.loads(snapshot.read_text(encoding="utf-8"))
        self.assertEqual(expected, app.openapi())


if __name__ == "__main__":
    unittest.main()
