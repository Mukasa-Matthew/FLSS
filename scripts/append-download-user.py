#!/usr/bin/env python3
"""
Safely append a user to DOWNLOAD_USERS_JSON in backend/.env (JSON parse + rewrite).
Usage (on VPS, from repo root):
  python3 scripts/append-download-user.py dilli dilli
"""
import json
import re
import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: append-download-user.py <username> <password>", file=sys.stderr)
        sys.exit(1)
    new_user, new_pass = sys.argv[1], sys.argv[2]

    env_path = Path(__file__).resolve().parent.parent / "backend" / ".env"
    text = env_path.read_text(encoding="utf-8")

    m = re.search(r"^DOWNLOAD_USERS_JSON=(.*)$", text, re.MULTILINE)
    if not m:
        print("DOWNLOAD_USERS_JSON= line not found", file=sys.stderr)
        sys.exit(1)

    raw_val = m.group(1).strip()
    if raw_val.startswith('"') and raw_val.endswith('"'):
        inner = raw_val[1:-1].replace('\\"', '"')
    else:
        inner = raw_val

    users = json.loads(inner)
    if not isinstance(users, list):
        print("DOWNLOAD_USERS_JSON must be a JSON array", file=sys.stderr)
        sys.exit(1)

    if any(u.get("username") == new_user for u in users):
        print(f'User "{new_user}" already present ({len(users)} users) — nothing to do')
        return

    passwords = {u["password"] for u in users if isinstance(u, dict)}
    if new_pass in passwords:
        print("Error: password must be unique for each user.", file=sys.stderr)
        sys.exit(1)

    users.append({"username": new_user, "password": new_pass})
    inner_str = json.dumps(users, separators=(",", ":"))
    # .env value is a double-quoted string; json.dumps(inner_str) escapes it for the shell/dotenv line.
    new_line = f"DOWNLOAD_USERS_JSON={json.dumps(inner_str)}"
    new_text = re.sub(
        r"^DOWNLOAD_USERS_JSON=.*$", new_line, text, count=1, flags=re.MULTILINE
    )
    env_path.write_text(new_text, encoding="utf-8")
    print(f"OK — {len(users)} users (added {new_user})")


if __name__ == "__main__":
    main()
