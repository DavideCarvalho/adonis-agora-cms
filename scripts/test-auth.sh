#!/usr/bin/env bash
# e2e/auth.spec.ts: the CMS's own login, with reset e-mails going through @adonisjs/mail to a real
# SMTP server (Mailpit), in a throwaway container.
set -u
cd "$(dirname "$0")/.."
BLOG=$PWD/examples/blog
PORT=5614
MAILPIT=cms-auth-mailpit

docker rm -f "$MAILPIT" >/dev/null 2>&1
docker run -d --name "$MAILPIT" -p 127.0.0.1:11025:1025 -p 127.0.0.1:18025:8025 axllent/mailpit:latest >/dev/null
sleep 2

rm -f "$BLOG/auth.sqlite3"
export CMS_AUTH=builtin CMS_AUTH_E2E=1 SMTP_PORT=11025 MAILPIT_URL=http://127.0.0.1:18025
export APP_KEY=${APP_KEY:-e2e-only-key-not-a-secret-0123456789} NODE_ENV=${NODE_ENV:-development}
export HOST=127.0.0.1 PORT=$PORT DB_FILE=auth.sqlite3 CMS_WEBHOOK_PORT=$PORT

setsid bash -c "cd '$BLOG' && exec node ace.js serve --no-watch" >/tmp/cms-auth-web.log 2>&1 &
pid=$!
trap 'kill -- "-$pid" 2>/dev/null; docker rm -f "$MAILPIT" >/dev/null 2>&1' EXIT
sleep 12

CMS_BASE_URL=http://127.0.0.1:$PORT pnpm exec playwright test e2e/auth.spec.ts --timeout=30000 "$@"
