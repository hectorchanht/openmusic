#!/usr/bin/env python3
"""Dawn Gate - internal-content leak check.

Hector's law (2026-11-19): no .planning, no internal markdown, no secret
files in any Dawn repo tree. This check runs in CI on every push
(.github/workflows/dawn-gate.yml) and locally via .githooks/pre-push.
It is self-contained (Python 3 standard library only).

Usage: python3 check.py [repo-root]   (default: current directory)
Exit code 0 = clean, 1 = violations found.
"""
import os
import sys

# Per-repo configuration (baked in when this file was installed).
EXTRA_ALLOWED_MD = []
KEEP_PREFIXES = []
EXTRA_ALLOWED_DOTDIRS = ['.vscode']

# .well-known is a public web standard directory (served on purpose), never a leak.
ALLOWED_DOTDIRS = {".git", ".github", ".githooks", ".well-known"} | set(EXTRA_ALLOWED_DOTDIRS)
BANNED_DIRS = {".planning", "plans"}
SECRET_EXEMPT = {".env.example", ".env.sample", ".env.template"}


def md_allowed(rel_path):
    base = os.path.basename(rel_path)
    if base in EXTRA_ALLOWED_MD:
        return True
    stem = base[:-3] if base.lower().endswith(".md") else base
    if stem == "README" or stem.startswith(("README.", "README-", "README_")):
        return True
    if stem in ("LICENSE", "LICENCE", "NOTICE") or stem.startswith(("LICENSE-", "LICENCE-")):
        return True
    norm = rel_path.replace(os.sep, "/")
    return any(norm.startswith(p) for p in KEEP_PREFIXES)


def is_secret_name(base):
    low = base.lower()
    if low in SECRET_EXEMPT:
        return False
    if low == ".env" or low.startswith(".env."):
        return True
    if low.endswith(".pem") or low.endswith(".key"):
        return True
    if "secret" in low or "credential" in low:
        return True
    return False


def main():
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else ".")
    violations = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root).replace(os.sep, "/")
        if rel_dir == ".":
            rel_dir = ""
        keep_dirs = []
        for d in dirnames:
            rel = (rel_dir + "/" + d).lstrip("/")
            if d in BANNED_DIRS:
                violations.append("banned directory: " + rel + "/")
            elif d.startswith(".") and d not in ALLOWED_DOTDIRS:
                violations.append("dotfile directory: " + rel + "/")
            else:
                keep_dirs.append(d)
        dirnames[:] = keep_dirs
        for f in filenames:
            rel = (rel_dir + "/" + f).lstrip("/")
            if f.lower().endswith(".md") and not md_allowed(rel):
                violations.append("internal markdown: " + rel)
            if is_secret_name(f):
                violations.append("secret-pattern file: " + rel)
    if violations:
        print("Dawn Gate: FAIL - internal content must not be pushed:")
        for v in violations:
            print("  - " + v)
        return 1
    print("Dawn Gate: OK - no internal content found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
