"""Look for things that look like real secrets in the files git tracks (and, with --history, in every past commit).

    python scripts/scan_secrets.py            # tracked files
    python scripts/scan_secrets.py --history  # also every revision (slower)

It prints only WHERE a match is and WHICH pattern matched, never the matching text, so the report itself is safe to share.
Exit code 1 when something is found. A stand-in for gitleaks, which could not be installed here.
"""
import re
import subprocess
import sys

PATTERNS = {
    "Groq API key": r"gsk_[A-Za-z0-9]{20,}",
    "OpenAI-style key": r"sk-[A-Za-z0-9_-]{24,}",
    "Pinecone key": r"pcsk_[A-Za-z0-9_]{20,}",
    "Google API key": r"AIza[0-9A-Za-z_-]{35}",
    "Google OAuth client secret": r"GOCSPX-[A-Za-z0-9_-]{20,}",
    "AWS access key id": r"AKIA[0-9A-Z]{16}",
    "GitHub token": r"gh[pousr]_[A-Za-z0-9]{30,}",
    "Slack token": r"xox[abprs]-[A-Za-z0-9-]{10,}",
    "private key block": r"-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----",
    "database URL with a password": r"(?:postgres(?:ql)?|mysql)(?:\+\w+)?://[^\s:/@]+:[^\s@/]{6,}@[^\s/]+",
    "JWT secret assigned in code": r"JWT_SECRET_KEY\s*=\s*['\"][^'\"\s]{12,}['\"]",
    "MSG91 auth key assigned in code": r"MSG91_AUTH_KEY\s*=\s*['\"][^'\"\s]{8,}['\"]",
    "ZenRows/Tavily key": r"(?:ZENROWS|TAVILY)_API_KEY\s*=\s*['\"][A-Za-z0-9]{16,}['\"]",
}
SKIP_PATHS = re.compile(r"(^|/)(venv|rag_venv|node_modules|chroma_data|dist|dist-e2e|\.git)/|\.(png|jpg|jpeg|gif|ico|pdf|docx|woff2?|ttf|bin|sqlite3?|db|enc)$|package-lock\.json$|tests/fixtures/")


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")


TEST_ONLY = {"JWT secret assigned in code", "MSG91 auth key assigned in code"}      # fixed throw-away values in tests are not secrets


def scan_files():
    hits = []
    files = [f for f in git("ls-files").stdout.splitlines() if not SKIP_PATHS.search(f)]
    for f in files:
        try:
            text = open(f, encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for name, rx in PATTERNS.items():
            if f.startswith("tests/") and name in TEST_ONLY:
                continue
            for m in re.finditer(rx, text):
                line = text.count("\n", 0, m.start()) + 1
                hits.append((f, line, name))
    return hits


TEXT_EXT = re.compile(r"\.(py|pyi|js|jsx|mjs|cjs|ts|tsx|json|md|txt|env|example|yml|yaml|html|htm|css|sh|bat|ps1|cfg|ini|toml|csv|sql|xml|conf|log)$", re.I)


def scan_history():
    """Every distinct text file version ever committed (each blob once), streamed through one `git cat-file --batch`."""
    import threading
    hits = []
    listing = git("rev-list", "--objects", "--all").stdout.splitlines()
    wanted = {}
    for line in listing:
        sha, _, path = line.partition(" ")
        if path and TEXT_EXT.search(path) and not SKIP_PATHS.search(path) and not re.search(r"(^|/)(site-packages|dist-info|\\.dist-info)(/|$)", path):
            wanted.setdefault(sha, path)
    compiled = {name: re.compile(rx) for name, rx in PATTERNS.items()}
    proc = subprocess.Popen(["git", "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE)

    def feed():
        try:
            for sha in wanted:
                proc.stdin.write((sha + "\n").encode())
            proc.stdin.close()
        except OSError:
            pass
    t = threading.Thread(target=feed, daemon=True)
    t.start()
    done = 0
    for sha, path in wanted.items():
        header = proc.stdout.readline().split()
        if len(header) < 3:
            continue
        size = int(header[2])
        data = proc.stdout.read(size)
        proc.stdout.read(1)
        done += 1
        if header[1] != b"blob" or size > 2_000_000:
            continue
        text = data.decode("utf-8", errors="ignore")
        for name, rx in compiled.items():
            if path.startswith("tests/") and name in TEST_ONLY:
                continue
            if rx.search(text):
                hits.append((f"{path} (blob {sha[:8]})", 0, name))
    proc.wait()
    print(f"history: {done} text file versions read")
    return hits


if __name__ == "__main__":
    found = scan_files()
    if "--history" in sys.argv:
        found += scan_history()
    unique = sorted(set(found))
    for f, line, name in unique:
        print(f"{f}:{line}  {name}" if line else f"{f}  {name}")
    print(f"\n{len(unique)} possible secret(s) found in {'files and history' if '--history' in sys.argv else 'tracked files'}.")
    sys.exit(1 if unique else 0)
