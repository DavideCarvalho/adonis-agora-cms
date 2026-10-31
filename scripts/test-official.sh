#!/usr/bin/env bash
# Runs e2e/official.spec.ts against real Redis and S3-compatible storage, in throwaway containers.
set -u
cd "$(dirname "$0")/.."

REDIS=cms-official-redis
S3=cms-official-s3
PORT=5612
BLOG=$PWD/examples/blog
pids=()

cleanup() {
  # `ace serve` spawns the server as a child, so stop the whole process group.
  for pid in "${pids[@]:-}"; do [ -n "$pid" ] && kill -- "-$pid" 2>/dev/null; done
  docker rm -f "$REDIS" "$S3" >/dev/null 2>&1
}
trap cleanup EXIT

docker rm -f "$REDIS" "$S3" >/dev/null 2>&1
docker run -d --name "$REDIS" -p 127.0.0.1:16399:6379 redis:7-alpine >/dev/null
docker run -d --name "$S3" -p 127.0.0.1:19000:9000 \
  -e RUSTFS_ACCESS_KEY=cmskey -e RUSTFS_SECRET_KEY=cmssecret123 rustfs/rustfs:1.0.3 >/dev/null
sleep 5

export CMS_AUTH=adonis CMS_QUEUE=redis DRIVE_DISK=s3 CMS_OFFICIAL=1
export REDIS_PORT=16399 S3_ENDPOINT=http://127.0.0.1:19000 S3_KEY=cmskey S3_SECRET=cmssecret123 S3_BUCKET=cms
export APP_KEY=${APP_KEY:-e2e-only-key-not-a-secret-0123456789} NODE_ENV=${NODE_ENV:-development}
export HOST=127.0.0.1 PORT=$PORT DB_FILE=official.sqlite3 CMS_WEBHOOK_PORT=$PORT

(cd "$BLOG" && node --input-type=module -e "
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
const s3 = new S3Client({ region: 'us-east-1', endpoint: process.env.S3_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.S3_KEY, secretAccessKey: process.env.S3_SECRET } });
await s3.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
") || exit 1

setsid bash -c "cd '$BLOG' && exec node ace.js serve --no-watch" >/tmp/cms-official-web.log 2>&1 &
pids+=($!)
setsid bash -c "cd '$BLOG' && exec node ace.js queue:work" >/tmp/cms-official-worker.log 2>&1 &
pids+=($!)
sleep 12

CMS_BASE_URL=http://127.0.0.1:$PORT pnpm exec playwright test e2e/official.spec.ts --timeout=20000 "$@"
status=$?
echo "web fell back to in-process delivery: $(grep -c 'failed to enqueue' /tmp/cms-official-web.log) times"
exit $status
