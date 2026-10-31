#!/usr/bin/env bash
# The webhook through @adonis-agora/durable in the booted example, failing if it fell back in process.
set -u
cd "$(dirname "$0")/.."
BLOG=$PWD/examples/blog
PORT=5613
LOG=/tmp/cms-durable-web.log

export CMS_JOBS=durable APP_KEY=${APP_KEY:-e2e-only-key-not-a-secret-0123456789} NODE_ENV=${NODE_ENV:-development}
export HOST=127.0.0.1 PORT=$PORT DB_FILE=durable.sqlite3 CMS_WEBHOOK_PORT=$PORT

setsid bash -c "cd '$BLOG' && exec node ace.js serve --no-watch" >"$LOG" 2>&1 &
pid=$!
trap 'kill -- "-$pid" 2>/dev/null' EXIT
sleep 12

CMS_BASE_URL=http://127.0.0.1:$PORT pnpm exec playwright test e2e/workflow.spec.ts -g webhook --timeout=20000
status=$?
fallbacks=$(grep -c 'failed to enqueue' "$LOG")
echo "fell back to in-process delivery: $fallbacks times"
[ "$fallbacks" -eq 0 ] || exit 1
exit $status
