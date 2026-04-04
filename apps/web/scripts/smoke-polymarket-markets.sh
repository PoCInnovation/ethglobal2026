#!/usr/bin/env bash
# Smoke test: GET /api/polymarket/markets returns JSON with success=true.
# Usage: API_BASE_URL=https://www.agentintents.io bash scripts/smoke-polymarket-markets.sh
set -euo pipefail
BASE="${API_BASE_URL:-https://www.agentintents.io}"
URL="${BASE%/}/api/polymarket/markets?limit=1"
if ! command -v jq >/dev/null 2>&1; then
	echo "jq is required" >&2
	exit 1
fi
BODY=$(curl -sS -w "\n%{http_code}" "$URL")
CODE=$(echo "$BODY" | tail -n1)
JSON=$(echo "$BODY" | sed '$d')
if [[ "$CODE" != "200" ]]; then
	echo "HTTP $CODE from $URL" >&2
	echo "$JSON" | head -c 500 >&2
	exit 1
fi
if echo "$JSON" | head -c 20 | grep -qi '<!doctype html\|<html'; then
	echo "Got HTML instead of JSON from $URL — /api may not be routed to serverless (check Vercel project root = apps/web)." >&2
	exit 1
fi
if ! echo "$JSON" | jq -e '.success == true and (.markets | type == "array")' >/dev/null; then
	echo "Unexpected JSON from $URL" >&2
	echo "$JSON" | head -c 800 >&2
	exit 1
fi
echo "OK: $URL"
