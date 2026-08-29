"""Export or verify the deterministic frontend OpenAPI contract."""

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.main import app


def rendered() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in {"export", "check"}:
        print("usage: python scripts/openapi.py <export|check> <snapshot>")
        return 2

    mode, raw_path = sys.argv[1:]
    path = pathlib.Path(raw_path)
    current = rendered()
    if mode == "export":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(current, encoding="utf-8", newline="\n")
        print(f"wrote {path}")
        return 0

    if not path.exists() or path.read_text(encoding="utf-8") != current:
        print(f"OpenAPI drift detected: run export for {path}")
        return 1
    print(f"OpenAPI snapshot is current: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
