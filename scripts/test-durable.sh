#!/usr/bin/env bash
# @adonis-agora/durable in the booted example: the webhook, failing if it fell back in process, and a
# scheduled publish applied by `durable:work`, with the web process's own timer off.
set -u
cd "$(dirname "$0")/.."
BLOG=$PWD/examples/blog
PORT=5613
LOG=/tmp/cms-durable-web.log
WORKER_LOG=/tmp/cms-durable-worker.log

export CMS_JOBS=durable CMS_SCHEDULER=off APP_KEY=${APP_KEY:-e2e-only-key-not-a-secret-0123456789} NODE_ENV=${NODE_ENV:-development}
export HOST=127.0.0.1 PORT=$PORT DB_FILE=durable.sqlite3 CMS_WEBHOOK_PORT=$PORT

setsid bash -c "cd '$BLOG' && exec node ace.js serve --no-watch" >"$LOG" 2>&1 &
pid=$!
worker=
trap 'kill -- "-$pid" 2>/dev/null; [ -n "$worker" ] && kill -- "-$worker" 2>/dev/null' EXIT
sleep 12

export CMS_BASE_URL=http://127.0.0.1:$PORT
pnpm exec playwright test e2e/workflow.spec.ts -g webhook --timeout=20000
status=$?
fallbacks=$(grep -c 'failed to enqueue' "$LOG")
echo "fell back to in-process delivery: $fallbacks times"
[ "$fallbacks" -eq 0 ] || exit 1
[ "$status" -eq 0 ] || exit "$status"

setsid bash -c "cd '$BLOG' && exec node ace.js durable:work" >"$WORKER_LOG" 2>&1 &
worker=$!
sleep 5
E2E_SCHEDULE_TIMEOUT=50000 pnpm exec playwright test e2e/workflow.spec.ts -g 'scheduled publish' --timeout=70000
