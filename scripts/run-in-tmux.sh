#!/bin/bash
# nexus-status keepalive wrapper.
# Invoked by launchd every 60s. If the tmux session is missing or the
# node process inside it has died, recreate it. Otherwise no-op.
set -e
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH
SESSION="nexus-status"
TMUX=/usr/local/bin/tmux
REPO="$HOME/dev/tools/nexus-status"
LOG=/tmp/nexus-status.log

if $TMUX has-session -t "$SESSION" 2>/dev/null; then
  if lsof -iTCP:3457 -sTCP:LISTEN >/dev/null 2>&1; then
    exit 0
  fi
  $TMUX kill-session -t "$SESSION" 2>/dev/null || true
fi

echo "[$(date -Iseconds)] starting nexus-status tmux session" >> "$LOG"
$TMUX new-session -d -s "$SESSION" -c "$REPO" \
  "exec npm start >> $LOG 2>&1"
