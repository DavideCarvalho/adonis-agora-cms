#!/usr/bin/env bash
# What someone new does: a fresh Adonis app, `node ace add` from the packed tarballs, the panel and the API.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
PORT=5631
server=
cleanup() {
  [ -n "$server" ] && kill -- "-$server" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir "$WORK/tgz"
for package in adonis admin react client; do
  (cd "$ROOT/packages/$package" && pnpm pack --pack-destination "$WORK/tgz" >/dev/null)
done

cd "$WORK"
CI=true npx --yes create-adonisjs@latest app --kit=api --pkg=npm --no-git-init </dev/null >/dev/null 2>&1 || true
cd app
npm install --no-audit --no-fund >/dev/null 2>&1
[ -f .env ] || cp .env.example .env
node ace generate:key >/dev/null

npm install "$WORK"/tgz/*.tgz --no-audit --no-fund --legacy-peer-deps >/dev/null 2>&1
node ace configure @adonis-agora/cms </dev/null
node ace configure @adonis-agora/cms-admin </dev/null
test -f config/cms.ts
test -f app/services/cms.ts
# The types a new user gets through `#services/cms`: a real field checks, a typo in one does not.
cat > app/services/cms_types_check.ts <<'EOF'
import cms from '#services/cms'

export async function check() {
  const { docs } = await cms.collection('posts').find()
  const title: string = docs[0]!.title
  // @ts-expect-error not a field of posts
  docs[0]!.titel
  return title
}
EOF
npx tsc --noEmit
rm app/services/cms_types_check.ts

expect() {
  if [ "$2" != "$3" ]; then
    echo "FAILED: $1: expected $2, got $3"
    tail -30 "$WORK/server.log"
    exit 1
  fi
  echo "ok: $1"
}

start() {
  NODE_ENV=$1 PORT=$PORT HOST=127.0.0.1 setsid node ace serve --no-watch >"$WORK/server.log" 2>&1 </dev/null &
  server=$!
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/admin" && return
    sleep 1
  done
  tail -30 "$WORK/server.log"
  exit 1
}
stop() {
  kill -- "-$server"
  server=
  sleep 2
}
status() {
  curl -s -o /dev/null -w '%{http_code}' "$@"
}
API=http://127.0.0.1:$PORT/api/cms/collections/posts
write() {
  status -X POST "$API" -H 'content-type: application/json' -d '{"title":"First"}'
}

start development
expect 'the panel' 200 "$(status "http://127.0.0.1:$PORT/admin")"
expect 'a write in development' 201 "$(write)"
expect 'a read' 200 "$(status "$API")"
stop

# A removed field must not stop the app or the commands, and the plan must say what would go.
sed -i "/fields.date('publishedAt'),/d" config/cms.ts
start development
expect 'the panel after removing a field' 200 "$(status "http://127.0.0.1:$PORT/admin")"
stop
set +e
node ace cms:diff >/dev/null 2>&1
expect 'cms:diff reports the destructive change' 2 "$?"
set -e
node ace cms:sync --force
node ace cms:diff

start production
expect 'an anonymous write in production' 401 "$(write)"
expect 'a read in production' 200 "$(status "$API")"
stop
