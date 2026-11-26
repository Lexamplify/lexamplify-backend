# LexAmplify — AWS EC2 single-box deploy (Caddy + gunicorn)

One EC2 instance serves everything: Caddy terminates TLS for the domain, serves
the built SPA, and reverse-proxies `/api/*` to gunicorn (`127.0.0.1:8000`).
Backend talks to Supabase Postgres (unchanged). Single repo, branch
`release/founder-testing`.

## Prerequisites (you provide)
- EC2 public IP / DNS, SSH user (`ubuntu` or `ec2-user`), and the `.pem` key.
- Domain for the app (DNS A record → the EC2 public IP) and open SG ports 22/80/443.
- Backend env values (see `backend.env.example`).
- WordCraft engine files (gitignored) — see step 4.

## 1. Base packages (on the box)
```bash
sudo apt update
sudo apt install -y python3-venv python3-pip git curl
# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 2. Code
```bash
sudo mkdir -p /opt/lexamplify && sudo chown $USER:$USER /opt/lexamplify
git clone -b release/founder-testing https://github.com/Lexamplify/lexamplify-backend.git /opt/lexamplify
cd /opt/lexamplify
python3 -m venv venv && ./venv/bin/pip install -U pip
./venv/bin/pip install -r requirements.txt
```

## 3. Backend env + service
```bash
sudo mkdir -p /etc/lexamplify
sudo cp deploy/aws/backend.env.example /etc/lexamplify/backend.env
sudo nano /etc/lexamplify/backend.env      # fill real values
sudo cp deploy/aws/lexamplify-backend.service /etc/systemd/system/
# set User= to your deploy user in the unit if not 'ubuntu'
sudo systemctl daemon-reload
sudo systemctl enable --now lexamplify-backend
curl -s localhost:8000/api/ping            # expect a JSON ok
```

## 4. WordCraft engine (REQUIRED or the Auto-Draft editor breaks)
The WASM engine under `frontend/public/wordcraft/` is gitignored. Populate it
before building. Source, in order of preference:
- copy from a prior build you have, OR
- pull the files from the currently-live site:
  `app.lexamplify.com/wordcraft/` (index.html + its assets) into
  `frontend/public/wordcraft/`.
Verify `frontend/public/wordcraft/index.html` exists.

## 5. Frontend build
```bash
cd /opt/lexamplify/frontend
npm ci                       # fresh install; stale node_modules fails the build
npm run build                # vite build; copies public/ (incl. wordcraft) into dist/
ls dist/wordcraft/index.html # MUST exist
```
`VITE_API_BASE_URL` stays empty → relative `/api/*` → Caddy proxies same-origin.

## 6. Caddy + domain
```bash
echo "LEX_DOMAIN=your.domain.com" | sudo tee /etc/default/caddy-lex   # or export in the unit
sudo cp deploy/aws/Caddyfile /etc/caddy/Caddyfile
# ensure LEX_DOMAIN is in Caddy's environment (systemd drop-in or /etc/caddy env)
sudo systemctl reload caddy
```
DNS A record → EC2 IP must resolve first; Caddy then auto-issues TLS.

## 7. Verify
- `https://your.domain.com` loads the app.
- `https://your.domain.com/api/ping` returns JSON.
- `https://your.domain.com/wordcraft/index.html` serves the engine (WASM), NOT the app shell.
- Register → login → create a workspace → open the draft editor.

## Updates later
```bash
cd /opt/lexamplify && git pull
./venv/bin/pip install -r requirements.txt
sudo systemctl restart lexamplify-backend
cd frontend && npm ci && npm run build
```

## Notes
- RLS: the app still connects to Supabase as the `postgres` role (bypasses RLS).
  The `app_rls` cutover is a separate, later `DATABASE_URL` swap (see migrations/rls/README.md).
- Redis/Celery (optional): `docker compose up -d redis` + a celery unit only if
  background jobs are enabled; the web app runs without them.
