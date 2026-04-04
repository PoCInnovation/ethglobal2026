#!/bin/sh
# Copies static doc assets for local preview. Docker image builds from apps/web/public directly
# via apps/doc/docker-compose.yml (no need to run this before docker compose).
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_PUBLIC="$SCRIPT_DIR/../web/public"
DOC_PUBLIC="$SCRIPT_DIR/public"

rm -rf "$DOC_PUBLIC"
mkdir -p "$DOC_PUBLIC/agent-context"

cp "$WEB_PUBLIC/agent-context.json" "$DOC_PUBLIC/"
cp "$WEB_PUBLIC/agent-context.md"   "$DOC_PUBLIC/"
cp "$WEB_PUBLIC/openapi.json"       "$DOC_PUBLIC/"
cp "$WEB_PUBLIC/agent-context/index.html" "$DOC_PUBLIC/agent-context/"

# index.html at root redirects to the HTML docs
cat > "$DOC_PUBLIC/index.html" << 'HTML'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0; url=/agent-context/index.html" />
  <title>Agent Intents Documentation</title>
</head>
<body>
  <p>Redirecting to <a href="/agent-context/index.html">documentation</a>…</p>
</body>
</html>
HTML

echo "Documentation files copied to $DOC_PUBLIC"
