#!/bin/zsh
set -euo pipefail

AGENT="com.soapextractor.daily"
PLIST="$HOME/Library/LaunchAgents/$AGENT.plist"
LOG_DIR="$HOME/Documents/soap-notes-extractor"
OUT="$LOG_DIR/scheduler.log"
ERR="$LOG_DIR/scheduler-error.log"

echo "Ensuring Node path in plist is current…"

# Detect current node
CUR_NODE_PATH=$(command -v node || true)
if [[ -z "${CUR_NODE_PATH}" ]]; then
  # Fallback to Homebrew default
  if [[ -x "/opt/homebrew/bin/node" ]]; then
    CUR_NODE_PATH="/opt/homebrew/bin/node"
  elif [[ -x "/usr/local/bin/node" ]]; then
    CUR_NODE_PATH="/usr/local/bin/node"
  else
    echo "Could not find node in PATH and no Homebrew/USR local node found." >&2
    echo "Install Node or adjust PATH in $PLIST." >&2
    exit 1
  fi
fi

# Replace node path inside the zsh command argument if it differs
if ! grep -q "$CUR_NODE_PATH" "$PLIST"; then
  echo "Updating node path in $PLIST to $CUR_NODE_PATH"
  /usr/bin/sed -i '' "s#/opt/homebrew/bin/node#$CUR_NODE_PATH#g" "$PLIST" || true
  /usr/bin/sed -i '' "s#/usr/local/bin/node#$CUR_NODE_PATH#g" "$PLIST" || true
  echo "Reloading LaunchAgent with updated node path…"
  launchctl bootout gui/$(id -u) "$PLIST" || true
  launchctl bootstrap gui/$(id -u) "$PLIST"
  launchctl enable gui/$(id -u)/$AGENT || true
fi

echo "Kickstarting $AGENT…"
if ! launchctl print gui/$(id -u)/$AGENT >/dev/null 2>&1; then
  echo "Agent not loaded. Bootstrapping…"
  launchctl bootstrap gui/$(id -u) "$PLIST" || true
  launchctl enable gui/$(id -u)/$AGENT || true
fi

launchctl kickstart -k gui/$(id -u)/$AGENT
echo "Tailing logs (Ctrl+C to stop)…"
touch "$OUT" || true
if [ -f "$ERR" ]; then
  tail -n 50 -f "$OUT" "$ERR"
else
  tail -n 50 -f "$OUT"
fi
