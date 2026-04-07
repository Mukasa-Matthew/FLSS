#!/usr/bin/env python3
"""
Replace DOWNLOAD_USERS_JSON in backend/.env from a JSON file (array of {username, password}).

  python3 scripts/apply-download-users-json.py path/to/users.json

Passwords must be unique (same rule as the server).
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        print("Usage: apply-download-users-json.py <users.json>", file=sys.stderr)
        sys.exit(1)

    src = Path(sys.argv[1])
    if not src.is_file():
        print(f"Not found: {src}", file=sys.stderr)
        sys.exit(1)

    users = json.loads(src.read_text(encoding="utf-8"))
    if not isinstance(users, list) or not users:
        print("JSON must be a non-empty array of objects", file=sys.stderr)
        sys.exit(1)

    seen: set[str] = set()
    for u in users:
        if not isinstance(u, dict) or "username" not in u or "password" not in u:
            print("Each item needs username and password", file=sys.stderr)
            sys.exit(1)
        p = str(u["password"])
        if p in seen:
            print("Error: each password must be unique.", file=sys.stderr)
            sys.exit(1)
        seen.add(p)

    env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
    if not env_path.is_file():
        print(f"Missing {env_path}", file=sys.stderr)
        sys.exit(1)

    inner_str = json.dumps(users, separators=(",", ":"))
    new_line = f"DOWNLOAD_USERS_JSON={json.dumps(inner_str)}"

    text = env_path.read_text(encoding="utf-8")
    if re.search(r"^DOWNLOAD_USERS_JSON=", text, re.MULTILINE):
        text = re.sub(
            r"^DOWNLOAD_USERS_JSON=.*$", new_line, text, count=1, flags=re.MULTILINE
        )
    else:
        if text and not text.endswith("\n"):
            text += "\n"
        text += new_line + "\n"

    env_path.write_text(text, encoding="utf-8")
    print(f"OK — wrote {len(users)} users to {env_path}")


if __name__ == "__main__":
    main()
