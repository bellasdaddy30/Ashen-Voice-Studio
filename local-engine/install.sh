#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENGINE_HOME="$HOME/.local/share/ashen-voice/engine"
VENV="$ENGINE_HOME/.venv"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT="$UNIT_DIR/ashen-expressive.service"
PORT=8765

mkdir -p "$ENGINE_HOME" "$UNIT_DIR"
cp "$HERE/ashen_expressive_server.py" "$ENGINE_HOME/ashen_expressive_server.py"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Installing ffmpeg…"
  sudo apt-get update
  sudo apt-get install -y ffmpeg curl
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv Python manager…"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

UV_BIN="$(command -v uv || true)"
if [ -z "$UV_BIN" ] && [ -x "$HOME/.local/bin/uv" ]; then UV_BIN="$HOME/.local/bin/uv"; fi
if [ -z "$UV_BIN" ]; then echo "uv was not found after installation."; exit 1; fi

rm -rf "$VENV"
"$UV_BIN" venv --python 3.11 "$VENV"
"$UV_BIN" pip install --python "$VENV/bin/python" --upgrade pip
"$UV_BIN" pip install --python "$VENV/bin/python" "chatterbox-tts==0.1.7" "fastapi>=0.115" "uvicorn[standard]>=0.30" "python-multipart>=0.0.9"

cat > "$UNIT" <<EOF
[Unit]
Description=Ashen Voice Chatterbox Nano Expressive Engine
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$ENGINE_HOME
Environment=PYTHONUNBUFFERED=1
ExecStart=$VENV/bin/python -m uvicorn ashen_expressive_server:app --host 127.0.0.1 --port $PORT
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now ashen-expressive.service

if command -v tailscale >/dev/null 2>&1; then
  echo
  echo "Publishing the private engine over Tailscale HTTPS…"
  tailscale serve --bg "$PORT" || true
  echo
  tailscale serve status || true
else
  echo "Tailscale command not found. Install/start Tailscale, then run: tailscale serve --bg $PORT"
fi

echo
echo "Engine service status:"
systemctl --user --no-pager --full status ashen-expressive.service | sed -n '1,12p' || true

echo
echo "Local health check:"
curl -fsS "http://127.0.0.1:$PORT/health" || true
echo
echo "Install complete. Copy the HTTPS *.ts.net address shown by 'tailscale serve status' into Ashen Voice Studio → Voice Lab → Expressive Reference Engine."
