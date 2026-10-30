"""scripts/smoke.py itself must work: run it against the throw-away backend and prove a failing check turns the exit code to 1."""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _run(*args, env=None):
    return subprocess.run([sys.executable, os.path.join(ROOT, "scripts", "smoke.py"), *args], capture_output=True, text=True, timeout=240,
                          env={**os.environ, **(env or {})}, encoding="utf-8")


def test_the_smoke_script_passes_against_a_healthy_backend(stack):
    r = _run("http://127.0.0.1:5000", "--register")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "All checks passed" in r.stdout and "FAIL" not in r.stdout


def test_the_smoke_script_refuses_to_create_accounts_on_a_real_address(stack):
    r = _run("https://api.example.com", "--register")
    assert r.returncode == 2 and "only allowed for a local address" in r.stdout


def test_the_smoke_script_reports_a_failure_with_exit_code_1(stack):
    r = _run("http://127.0.0.1:5000", env={"SMOKE_EMAIL": "nobody@example.com", "SMOKE_PASSWORD": "wrong-password-1"})
    assert r.returncode == 1 and "FAIL  sign in" in r.stdout
