#!/usr/bin/env bash
# Pipeline manuelle « agent → Polymarket » alignée sur la doc agent-context :
#   1) Découverte marché (API prod si dispo, sinon Gamma)
#   2) POST polymarket_trade (AgentAuth viem via agent-auth-header.mjs)
#   3) Affichage paymentUrl + pause optionnelle pour signer au Ledger
#   4) Poll jusqu’à un statut terminal (incl. authorized pour Polymarket)
#
# Prérequis : Node.js, curl, jq, pnpm install (viem). Optionnel : cast (affiche l’adresse signataire).
#
# Logs : par défaut verbeux. Désactiver le détail : VERBOSE=0 ./script2.sh
#        Requêtes HTTP brutes : CURL_VERBOSE=1 ./script2.sh (très verbeux)
#
# Exemples :
#   API_URL=https://www.agentintents.io FRONTEND_URL=https://www.agentintents.io ./script2.sh
#   SEARCH_Q=bitcoin AMOUNT=10 OUTCOME=Yes MANUAL_PAUSE=1 ./script2.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT_AUTH_HELPER="${AGENT_AUTH_HELPER:-$ROOT/apps/web/scripts/agent-auth-header.mjs}"
CREDENTIAL_FILE="${CREDENTIAL_FILE:-$ROOT/agent-credential.json}"

# API qui implémente POST /api/intents + enrichissement Polymarket (souvent prod ou vercel dev sur apps/web)
API_URL="${API_URL:-https://www.agentintents.io}"
# URL affichée pour /pay/<id> (souvent la même que l’app web)
FRONTEND_URL="${FRONTEND_URL:-https://www.agentintents.io}"

AGENT_ID="${AGENT_ID:-manual-test-agent}"
AMOUNT="${AMOUNT:-10}"
OUTCOME="${OUTCOME:-Yes}" # Yes | No
SEARCH_Q="${SEARCH_Q:-}"
MARKETS_LIMIT="${MARKETS_LIMIT:-15}"
MANUAL_PAUSE="${MANUAL_PAUSE:-0}" # 1 = attend Entrée après l’URL de paiement
POLL_INTERVAL="${POLL_INTERVAL:-5}"
POLL_MAX="${POLL_MAX:-120}"
VERBOSE="${VERBOSE:-1}"
CURL_VERBOSE="${CURL_VERBOSE:-0}"

log() {
	printf '%s [%s] %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "script2" "$*" >&2
}

log_dbg() {
	[[ "$VERBOSE" == "1" ]] || return 0
	log "DBG $*"
}

# Affiche les 2 premiers segments AgentAuth (timestamp + bodyHash), tronque la signature.
log_agent_auth_meta() {
	local auth="$1"
	local rest="${auth#AgentAuth }"
	local ts="${rest%%.*}"
	local after="${rest#*.}"
	local bh="${after%%.*}"
	log "AgentAuth timestamp=$ts bodyHash=${bh:0:20}… (signature omise)"
}

if [[ ! -f "$CREDENTIAL_FILE" ]]; then
	log "ERREUR: fichier credential introuvable: $CREDENTIAL_FILE"
	exit 1
fi

if ! command -v node >/dev/null 2>&1 || ! command -v jq >/dev/null 2>&1; then
	log "ERREUR: node et jq sont requis"
	exit 1
fi

if [[ ! -f "$AGENT_AUTH_HELPER" ]]; then
	log "ERREUR: helper introuvable: $AGENT_AUTH_HELPER"
	exit 1
fi

log "=== Démarrage script2.sh (ROOT=$ROOT) ==="
log "Config: API_URL=$API_URL FRONTEND_URL=$FRONTEND_URL"
log "Config: AGENT_ID=$AGENT_ID AMOUNT=$AMOUNT OUTCOME=$OUTCOME SEARCH_Q=${SEARCH_Q:-∅} MARKETS_LIMIT=$MARKETS_LIMIT"
log "Config: MANUAL_PAUSE=$MANUAL_PAUSE POLL_INTERVAL=${POLL_INTERVAL}s POLL_MAX=$POLL_MAX VERBOSE=$VERBOSE CURL_VERBOSE=$CURL_VERBOSE"
log "Credential: path=$CREDENTIAL_FILE (clé privée non affichée)"

AGENT_LABEL=$(jq -r '.label // "agent"' "$CREDENTIAL_FILE")
TRUSTCHAIN_ID=$(jq -r '.trustchainId // empty' "$CREDENTIAL_FILE")
PUBKEY=$(jq -r '.publicKey // empty' "$CREDENTIAL_FILE")
log "Agent JSON: label=$AGENT_LABEL trustchainId=${TRUSTCHAIN_ID:-?} publicKey=${PUBKEY:0:20}…"

if command -v cast >/dev/null 2>&1; then
	PK=$(jq -r '.privateKey' "$CREDENTIAL_FILE")
	SIGNER_ADDR=$(cast wallet address --private-key "$PK")
	log "Signataire EIP-191 (cast): $SIGNER_ADDR"
else
	log "cast absent — adresse signataire non affichée (optionnel)"
fi

agent_auth_post() { node "$AGENT_AUTH_HELPER" post "$1" "$CREDENTIAL_FILE"; }
agent_auth_get() { node "$AGENT_AUTH_HELPER" get "$CREDENTIAL_FILE"; }

CURL_COMMON=(-sS)
[[ "$CURL_VERBOSE" == "1" ]] && CURL_COMMON=(-sS -v) && log "DBG curl mode verbeux activé (CURL_VERBOSE=1)"

echo ""
log "=== Étape 1 — Marché Polymarket actif ==="
MARKETS_URL="${API_URL%/}/api/polymarket/markets?limit=${MARKETS_LIMIT}"
[[ -n "$SEARCH_Q" ]] && MARKETS_URL="${MARKETS_URL}&q=$(printf %s "$SEARCH_Q" | jq -sRr @uri)"

log "GET markets URL: $MARKETS_URL"
TMP_MARKETS=$(mktemp)
META=$(curl "${CURL_COMMON[@]}" -o "$TMP_MARKETS" -w '%{http_code}|%{size_download}|%{time_total}' "$MARKETS_URL" || echo "000|0|0")
IFS='|' read -r HTTP_M SZ_M TIME_M <<<"$META"
log "Réponse marchés (API): HTTP=$HTTP_M bytes=$SZ_M time_s=$TIME_M"
RAW=$(<"$TMP_MARKETS")
rm -f "$TMP_MARKETS"
log_dbg "Corps marchés (API) premiers 200 octets: $(printf '%s' "$RAW" | head -c 200 | tr '\n' ' ')"

USE_GAMMA=0
if echo "$RAW" | head -c 30 | grep -qiE '<!doctype|<html'; then
	log "L’API a renvoyé du HTML (SPA / routage) → fallback Gamma."
	USE_GAMMA=1
elif ! echo "$RAW" | jq -e '.success == true' >/dev/null 2>&1; then
	log "Réponse API marchés JSON inattendu (success!=true ou parse) → fallback Gamma."
	log_dbg "jq .success: $(echo "$RAW" | jq -r '.success // "null"' 2>/dev/null || echo 'parse_error')"
	USE_GAMMA=1
else
	NM=$(echo "$RAW" | jq -r '.markets | length // 0' 2>/dev/null || echo 0)
	log "API marchés OK: nombre de marchés dans la réponse=$NM"
fi

if [[ "$USE_GAMMA" -eq 0 ]]; then
	CONDITION_ID=$(echo "$RAW" | jq -r '.markets[0].conditionId // empty')
	MARKET_Q=$(echo "$RAW" | jq -r '.markets[0].question // empty')
	log "Sélection: premier marché de la liste API (markets[0])"
	log_dbg "Aperçu liste (3 max): $(echo "$RAW" | jq -c '[.markets[:3][] | {question, conditionId}]' 2>/dev/null || true)"
else
	GAMMA_URL="https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=50&order=volume&ascending=false"
	log "GET Gamma: $GAMMA_URL"
	TMP_G=$(mktemp)
	META_G=$(curl "${CURL_COMMON[@]}" -o "$TMP_G" -w '%{http_code}|%{size_download}|%{time_total}' "$GAMMA_URL" || echo "000|0|0")
	IFS='|' read -r HTTP_G SZ_G TIME_G <<<"$META_G"
	log "Réponse Gamma: HTTP=$HTTP_G bytes=$SZ_G time_s=$TIME_G"
	GAMMA_RAW=$(<"$TMP_G")
	rm -f "$TMP_G"
	GCOUNT=$(echo "$GAMMA_RAW" | jq 'length' 2>/dev/null || echo 0)
	log "Gamma: tableau markets length=$GCOUNT"
	if [[ -n "$SEARCH_Q" ]]; then
		log "Filtre recherche (question contains, insensible à la casse): q=$SEARCH_Q"
		CONDITION_ID=$(echo "$GAMMA_RAW" | jq -r --arg q "$SEARCH_Q" '
			[.[] | select(.conditionId != null and .conditionId != "")
			  | select((.question | ascii_downcase | contains($q | ascii_downcase)))]
			| first | .conditionId // empty')
		MARKET_Q=$(echo "$GAMMA_RAW" | jq -r --arg cid "$CONDITION_ID" '[.[] | select(.conditionId == $cid)] | first | .question // empty')
	else
		log "Pas de SEARCH_Q: premier marché actif+ouvert avec conditionId 0x…64 hex"
		CONDITION_ID=$(echo "$GAMMA_RAW" | jq -r '
			[.[] | select(.active == true and .closed == false and (.conditionId | test("^0x[a-fA-F0-9]{64}$")))]
			| first | .conditionId // empty')
		MARKET_Q=$(echo "$GAMMA_RAW" | jq -r --arg cid "$CONDITION_ID" '[.[] | select(.conditionId == $cid)] | first | .question // empty')
	fi
fi

if [[ -z "$CONDITION_ID" || "$CONDITION_ID" == "null" ]]; then
	log "ERREUR: aucun conditionId trouvé."
	exit 1
fi
log "Marché retenu — question: $MARKET_Q"
log "Marché retenu — conditionId: $CONDITION_ID"
log "Trade prévu — outcome=$OUTCOME montant=${AMOUNT} USDC chainId=137"

echo ""
log "=== Étape 2 — Corps d’intent polymarket_trade ==="
BODY=$(jq -cn \
	--arg agentId "$AGENT_ID" \
	--arg agentName "$AGENT_LABEL" \
	--arg cid "$CONDITION_ID" \
	--arg amount "$AMOUNT" \
	--arg outcome "$OUTCOME" \
	'{
		agentId: $agentId,
		agentName: $agentName,
		details: {
			type: "polymarket_trade",
			conditionId: $cid,
			outcome: $outcome,
			amount: $amount,
			chainId: 137,
			memo: "script2.sh — test manuel pipeline Polymarket"
		},
		urgency: "normal",
		expiresInMinutes: 60
	}')
BODY_LEN=${#BODY}
log "Body JSON compact: ${BODY_LEN} caractères"
log_dbg "Body: $BODY"

echo ""
INTENTS_URL="${API_URL%/}/api/intents"
log "=== Étape 3 — POST $INTENTS_URL (AgentAuth) ==="
log "Génération header via: node $AGENT_AUTH_HELPER post …"
AUTH=$(agent_auth_post "$BODY")
log "Header Authorization construit (${#AUTH} caractères)"
log_agent_auth_meta "$AUTH"

TMP=$(mktemp)
META_POST=$(curl "${CURL_COMMON[@]}" -o "$TMP" -w '%{http_code}|%{time_total}' -X POST "$INTENTS_URL" \
	-H "Content-Type: application/json" \
	-H "Authorization: $AUTH" \
	-d "$BODY" || echo "000|0")
IFS='|' read -r HTTP TIME_POST <<<"$META_POST"
RESP=$(<"$TMP")
rm -f "$TMP"

log "POST /api/intents: HTTP=$HTTP time_s=$TIME_POST réponse_bytes=${#RESP}"
if ! echo "$RESP" | jq . >/dev/null 2>&1; then
	log "ERREUR: réponse non-JSON:"
	printf '%s\n' "$RESP" | head -c 2000 >&2
	exit 1
fi
echo "$RESP" | jq .

SUCCESS=$(echo "$RESP" | jq -r '.success // false')
ERR_MSG=$(echo "$RESP" | jq -r '.error // empty')
if [[ "$SUCCESS" != "true" ]]; then
	log "Échec création intent: $ERR_MSG"
	if [[ "$HTTP" == "401" || "$ERR_MSG" == *Authentication* ]]; then
		log "Indice 401: vérifier que l’agent est enregistré sur Agent Intents (clé → trustchain), horloge NTP, et que le body hash correspond aux octets exacts du body (JSON compact)."
	fi
	exit 1
fi

INTENT_ID=$(echo "$RESP" | jq -r '.intent.id')
API_PAYMENT=$(echo "$RESP" | jq -r '.paymentUrl // empty')
PAYMENT_URL="${FRONTEND_URL%/}/pay/${INTENT_ID}"
log "Intent créé: id=$INTENT_ID"
log_dbg "Intent (extrait): $(echo "$RESP" | jq -c '.intent | {status, createdAt, details}' 2>/dev/null || true)"

echo ""
log "=== Étape 4 — Paiement / signature Ledger ==="
log "intent id   : $INTENT_ID"
log "paymentUrl (API): ${API_PAYMENT:-—}"
log "Ouvre dans le navigateur (app) : $PAYMENT_URL"

if [[ "$MANUAL_PAUSE" == "1" ]]; then
	log "MANUAL_PAUSE=1 — attente Entrée…"
	read -r -p "Signe sur Ledger puis appuie sur Entrée pour lancer le poll… " _
fi

echo ""
log "=== Étape 5 — Poll GET /api/intents/$INTENT_ID (authorized = ordre signé Polymarket) ==="
log "Poll: max $POLL_MAX itérations, intervalle ${POLL_INTERVAL}s"
STATUS="pending"
for i in $(seq 1 "$POLL_MAX"); do
	case "$STATUS" in authorized | confirmed | rejected | failed | expired)
		log "Statut terminal: $STATUS (sortie poll, itération $i)"
		break
		;;
	esac
	log "Poll: attente ${POLL_INTERVAL}s avant GET #$i…"
	sleep "$POLL_INTERVAL"
	GA=$(agent_auth_get)
	log_dbg "Poll #$i: AgentAuth généré (${#GA} car.)"
	POLL_URL="${API_URL%/}/api/intents/${INTENT_ID}"
	TMP_P=$(mktemp)
	META_P=$(curl "${CURL_COMMON[@]}" -o "$TMP_P" -w '%{http_code}|%{time_total}' -H "Authorization: $GA" "$POLL_URL" || echo "000|0")
	IFS='|' read -r HTTP_P TIME_P <<<"$META_P"
	PR=$(<"$TMP_P")
	rm -f "$TMP_P"
	STATUS=$(echo "$PR" | jq -r '.intent.status // empty' 2>/dev/null || echo "parse_error")
	if [[ "$STATUS" == "parse_error" ]] || [[ -z "$STATUS" ]]; then
		log "Poll #$i: HTTP=$HTTP_P time_s=$TIME_P status=<vide/erreur> corps=$(printf '%s' "$PR" | head -c 160 | tr '\n' ' ')"
	else
		log "Poll #$i: HTTP=$HTTP_P time_s=$TIME_P status=$STATUS"
	fi
	log_dbg "Poll #$i JSON intent: $(echo "$PR" | jq -c '.intent | {id, status, updatedAt} // .' 2>/dev/null || echo '?')"
done

echo ""
log "=== Fin — statut final: $STATUS ==="
log "Pour Polymarket: authorized = ordre signé côté intent ; confirmed = exécution on-chain selon backend."
