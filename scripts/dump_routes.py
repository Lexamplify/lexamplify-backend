"""Print every Flask route (method, path, endpoint, auth guard) from an isolated app.

Run:  python scripts/dump_routes.py [--json]
Uses a throw-away SQLite database and an ephemeral secret, so it never touches real data.
Reused by the red-team tests to walk app.url_map automatically.
"""
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

PUBLIC_PREFIXES = ("/api/auth/",)
PUBLIC_EXACT = {"/api/ping"}


def build_app():
    tmp = tempfile.mkdtemp(prefix="lex_routes_")
    os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(tmp, 'routes.db')}"
    os.environ.setdefault("JWT_SECRET_KEY", "routes-dump-secret-0123456789abcdef0123456789")
    os.environ.setdefault("PHONE_OTP_REQUIRED", "false")
    import app as app_module
    flask_app = app_module.create_app()
    flask_app.config.update(TESTING=True)
    return flask_app


def list_routes(flask_app):
    rows = []
    for rule in flask_app.url_map.iter_rules():
        methods = sorted(m for m in rule.methods if m not in ("HEAD", "OPTIONS"))
        if not methods:
            continue
        path = rule.rule
        if path.startswith("/api/"):
            public = path in PUBLIC_EXACT or path.startswith(PUBLIC_PREFIXES)
            gate = "public" if public else "signed-in"
        elif path.startswith("/static"):
            gate = "static"
        else:
            gate = "non-api"
        rows.append({"path": path, "methods": methods, "endpoint": rule.endpoint, "gate": gate})
    rows.sort(key=lambda r: (r["path"], r["methods"]))
    return rows


if __name__ == "__main__":
    rows = list_routes(build_app())
    if "--json" in sys.argv:
        print(json.dumps(rows, indent=1))
    else:
        for r in rows:
            print(f"{r['gate']:<10} {','.join(r['methods']):<22} {r['path']}   [{r['endpoint']}]")
        print(f"\n{len(rows)} routes")
