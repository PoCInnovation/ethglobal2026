## Plan: Dynamic Market Context In Forked Ethereum App

Conserver strictement le payload EIP-712 `Order` issu du SDK Polymarket (aucune modification du message signé), tout en ajoutant dans le fork `device_app` (Ethereum app) un canal de contexte marché dynamique et attesté.

## Invariants non negociables

1. Le flux EIP-712 actuel (`INS_SIGN_EIP_712_MESSAGE`, legacy/new impl) reste intact.
2. Le hash signe dans `ui_712_approve_cb()` doit rester identique avec ou sans MCP.
3. Le MCP est un canal parallele pre-signature, jamais un champ injecte dans le typed data.

## Plan detaille adapte au code `device_app`

### Etape 1 - Geler le comportement EIP-712 existant

Objectif: poser une baseline avant modification.

Actions techniques:
1. Capturer les chemins de signature actuels dans `device_app/src/main.c` (`INS_SIGN_EIP_712_MESSAGE` avec `P2_EIP712_LEGACY_IMPLEM` et `P2_EIP712_FULL_IMPLEM`).
2. Noter le point de calcul de hash signe dans `device_app/src/features/sign_message_eip712_common/common_712.c` (`ui_712_approve_cb`).
3. Ajouter un test de non-regression ragger sur un payload Polymarket de reference.

Definition of done:
1. Le meme typed data renvoie la meme signature avant/apres branche MCP (hors nonce ECDSA deterministe, verifier `domainHash` et `messageHash`).

### Etape 2 - Definir le format MCP binaire (TLV)

Objectif: reutiliser l'infra de streaming deja presente (`tlv_from_apdu`).

Actions techniques:
1. Definir un payload TLV canonicalise transporte par APDU, avec longueur totale sur 2 octets en tete (comme `PROVIDE_TX_SIMULATION`).
2. Tags minimum a supporter:
`STRUCTURE_TYPE`, `STRUCTURE_VERSION`, `CHAIN_ID`, `TOKEN_ID`, `ISSUED_AT`, `EXPIRES_AT`, `ATTESTER_ID`, `FIELDS_BLOB`, `CONTEXT_HASH`, `DER_SIGNATURE`.
3. Limiter la taille max du payload (ex: 1024 bytes) et du nombre de champs dynamiques (ex: 8) pour respecter RAM.

Fichiers cibles:
1. `device_app/src/features/provide_market_context/mcp_tlv.h` (nouveau)
2. `device_app/src/features/provide_market_context/mcp_tlv.c` (nouveau)

### Etape 3 - Ajouter un nouvel INS APDU MCP

Objectif: ajouter un canal APDU dedie avant `EIP712_SIGN`.

Actions techniques:
1. Ajouter `INS_PROVIDE_MARKET_CONTEXT` dans `device_app/src/apdu_constants.h` (proposition: `0x3A`, slot suivant `0x38`).
2. Ajouter `INS_STR` correspondant.
3. Declarer le handler dans `device_app/src/apdu_constants.h`.
4. Brancher le dispatch dans `device_app/src/main.c` avec semantique proche de `handle_tx_simulation`:
`p1=0x00` data, `p2` chunking (`P1_FIRST_CHUNK` / `P1_FOLLOWING_CHUNK`).

Fichiers cibles:
1. `device_app/src/apdu_constants.h`
2. `device_app/src/main.c`
3. `device_app/src/features/provide_market_context/cmd_provide_market_context.c` (nouveau)
4. `device_app/src/features/provide_market_context/cmd_provide_market_context.h` (nouveau)

### Etape 4 - Etat interne MCP et cycle de vie

Objectif: stocker le contexte valide entre APDU MCP et confirmation EIP-712.

Actions techniques:
1. Creer un contexte MCP dedie (hors `tmpCtx.messageSigningContext712`) pour ne pas perturber le flux historique.
2. Champs recommandes:
`valid`, `verified`, `required`, `policy_fail_close`, `chain_id`, `token_id[32]`, `issued_at`, `expires_at`, `attester_id`, `fields_count`, `fields[]`, `context_hash[32]`.
3. Ajouter `market_context_cleanup()` appele dans `reset_app_context()`.

Fichiers cibles:
1. `device_app/src/features/provide_market_context/market_context.h` (nouveau)
2. `device_app/src/features/provide_market_context/market_context.c` (nouveau)
3. `device_app/src/main.c` (hook cleanup)

### Etape 5 - Verification cryptographique de l'attestation

Objectif: valider que les donnees affichees sont attestees.

Actions techniques:
1. Recalculer `context_hash` device a partir de la forme canonique recues (ou verifier l'octet-a-octet du blob canonique fourni).
2. Verifier la signature DER via `check_signature_with_pubkey()` de `device_app/src/ledger_pki.c`.
3. Resoudre `attester_id -> pubkey` via table locale versionnee (premiere iteration), puis option manifest signee.
4. Verifier `issued_at` / `expires_at` / `chain_id`.

Fichiers cibles:
1. `device_app/src/features/provide_market_context/market_context_verify.c` (nouveau)
2. `device_app/src/features/provide_market_context/market_context_keys.c` (nouveau)
3. `device_app/src/features/provide_market_context/market_context_keys.h` (nouveau)

### Etape 6 - Liaison forte avec le typed data EIP-712

Objectif: empecher un MCP valide mais rattache a un autre ordre.

Actions techniques:
1. Au moment du `handle_eip712_sign()` dans `device_app/src/features/sign_message_eip712/commands_712.c`, imposer:
`MCP.token_id == typedData.message.tokenId` et `MCP.chain_id == eip712_context->chain_id`.
2. Ajouter extraction de `tokenId` pendant le parsing des fields EIP-712 (dans `field_hash.c`/`typed_data.c` selon le point le plus stable), sans modifier le hash.
3. Si mismatch:
`fail-close` => `SWO_REFERENCED_DATA_NOT_FOUND` ou `SWO_INCORRECT_DATA`.
`fail-open` => ignorer MCP et continuer en affichage EIP-712 standard.

Fichiers cibles:
1. `device_app/src/features/sign_message_eip712/commands_712.c`
2. `device_app/src/features/sign_message_eip712/field_hash.c`
3. `device_app/src/features/sign_message_eip712/context_712.h`

### Etape 7 - Injection UI MCP dans le flow de review

Objectif: afficher `Market`, `Outcome`, `Amount` puis champs additionnels.

Actions techniques:
1. Inserer une etape UI avant `ui_712_end_sign()` pour pousser des paires `item/value` MCP.
2. Priorite de rendu:
`market.name`, `market.outcome`, `market.amount`, puis ordre d'arrivee pour le reste.
3. Renderer type-aware:
`string`, `uint`, `decimal`, `percent`, `address` avec truncation Nano-safe.
4. Si champ inconnu, afficher en mode generique (`key: value`) et ne pas fail.

Fichiers cibles:
1. `device_app/src/features/sign_message_eip712/ui_logic.c`
2. `device_app/src/features/sign_message_eip712/ui_logic.h`
3. `device_app/src/features/provide_market_context/market_context_render.c` (nouveau)
4. `device_app/src/features/provide_market_context/market_context_render.h` (nouveau)

### Etape 8 - API client Python (SDK local device_app)

Objectif: exposer le nouvel INS MCP aux tests et a l'integration.

Actions techniques:
1. Ajouter `PROVIDE_MARKET_CONTEXT = 0x3A` dans `device_app/client/src/ledger_app_clients/ethereum/command_builder.py`.
2. Ajouter builder `provide_market_context()` avec chunking identique a `provide_tx_simulation()`.
3. Exposer la methode dans `device_app/client/src/ledger_app_clients/ethereum/client.py`.

Fichiers cibles:
1. `device_app/client/src/ledger_app_clients/ethereum/command_builder.py`
2. `device_app/client/src/ledger_app_clients/ethereum/client.py`

### Etape 9 - Tests ragger (integration device)

Objectif: couvrir nominal + erreurs de securite.

Actions techniques:
1. Ajouter `device_app/tests/ragger/test_market_context.py`.
2. Cas a couvrir:
nominal valide, signature invalide, expire, `tokenId` mismatch, `chainId` mismatch, champ inconnu, payload chunk long.
3. Verifier snapshots UI sur au moins Nano + Stax/Flex.
4. Ajouter un test de compatibilite: sans MCP, flow EIP-712 inchange.

### Etape 10 - Fuzzing et robustesse parsing

Objectif: proteger le parseur TLV et le renderer contre entrees malformees.

Actions techniques:
1. Ajouter harness `fuzz_market_context.c` sur parser TLV MCP + verify + render.
2. Reutiliser patterns de `tests/fuzzing/harness/fuzz_eip712.c`.
3. Ajouter assertions de borne memoire (taille champs, nb champs, overflow offset).

### Etape 11 - Integration web/backend

Objectif: envoyer MCP avant le flux EIP-712 existant.

Actions techniques:
1. Web: recuperer MCP atteste, envoyer `INS_PROVIDE_MARKET_CONTEXT`, puis sequence EIP-712 existante.
2. Backend: emettre MCP canonique avec TTL court et `attesterId`.
3. Journaliser `contextHash` + metadata pour audit.

Fichiers app:
1. `apps/web/src/lib/ledger-provider.tsx`
2. `apps/web/api/_lib/validation.ts`
3. `apps/backend/src/index.ts`

### Etape 12 - Rollout et politique d'echec

Objectif: activation progressive sans casser la prod.

Actions techniques:
1. Feature flag `LEDGER_MCP_CONTEXT` cote host et backend.
2. Default prod recommande: `fail-close` si MCP est requis.
3. Mode dev: `fail-open` autorise pour debuggage.
4. Telemetrie minimale: taux fallback, raisons d'echec verification, latence MCP.

## Verifications finales

1. Le hash EIP-712 signe (domain/message) est identique avec/sans MCP.
2. Le contexte affiche n'apparait que si attestation valide et non expiree.
3. `tokenId` affiche et `tokenId` signe sont lies cryptographiquement et logiquement.
4. En cas de MCP invalide, le comportement respecte strictement la policy choisie.
5. Les tests ragger/fuzz passent sur les devices cibles.

## Decisions de design

1. Inclus: nouveau canal APDU MCP dans `device_app`.
2. Exclu: toute modification du schema `Order` EIP-712 Polymarket.
3. Exclu: mapping statique `tokenId -> market` dans le firmware.
4. Recommande: parser backward-compatible sur 2 versions MCP (`contextVersion`).