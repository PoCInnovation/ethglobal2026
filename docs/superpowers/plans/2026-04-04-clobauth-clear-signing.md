# ClobAuth Clear Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add clear signing for the Polymarket ClobAuth EIP-712 message so the Ledger shows "Connect to Polymarket" + wallet address instead of raw typed data fields.

**Architecture:** New `TYPE_AUTH = 0x0B` TLV struct routed through the existing `INS_PROVIDE_MARKET_CONTEXT (0x3A)` APDU. Device app gets new `auth_context_t` state + TLV parser. Backend builds auth TLV payloads. Frontend detects `ClobAuth` primaryType and sends auth MCP before signing.

**Tech Stack:** C (Ledger BOLOS SDK / NBGL), TypeScript (Vercel serverless + React)

**Spec:** `docs/superpowers/specs/2026-04-04-clobauth-clear-signing-design.md`

---

## File Structure

### New files
| File | Responsibility |
|------|---------------|
| `device_app/src/features/provide_market_context/auth_context.h` | `auth_context_t` struct, globals, API declarations |
| `device_app/src/features/provide_market_context/auth_context.c` | Auth context state management (clear, is_valid, consume_or_clear) |
| `device_app/src/features/provide_market_context/auth_tlv.h` | `auth_parse_payload()` declaration |
| `device_app/src/features/provide_market_context/auth_tlv.c` | Auth TLV parser (X-macro pattern), signature verification |

### Modified files
| File | Change |
|------|--------|
| `device_app/src/features/provide_market_context/mcp_tlv.h` | Add `MCP_AUTH_STRUCT_TYPE`, `TAG_MCP_AUTH_LABEL`, `TAG_MCP_AUTH_ADDRESS` |
| `device_app/src/features/provide_market_context/cmd_provide_market_context.c` | Route by struct type byte before dispatching to parser |
| `device_app/src/features/sign_message_eip712/ui_logic.c` | Add `ui_712_inject_auth_screens()` |
| `device_app/src/features/sign_message_eip712/commands_712.c` | Auth-specific binding check (chain_id only, skip tokenId) |
| `device_app/src/features/sign_message_eip712/context_712.c` | Add `auth_context_consume_or_clear()` |
| `device_app/src/nbgl/ui_sign_712.c` | Auth-aware review titles, icon, button text |
| `apps/web/src/lib/polymarket-context.ts` | Add `isClobAuth()`, `buildAuthContext()`, update `fetchSignedMCPPayload()` |
| `apps/web/src/lib/ledger-provider.tsx` | Add ClobAuth detection in `signTypedDataV4()` |
| `apps/web/api/market-context/sign.ts` | Handle `type: "auth"` TLV building |

---

### Task 1: Add auth TLV constants to `mcp_tlv.h`

**Files:**
- Modify: `device_app/src/features/provide_market_context/mcp_tlv.h:7-9`

- [ ] **Step 1: Add new constants**

In `device_app/src/features/provide_market_context/mcp_tlv.h`, after line 9 (`#define MCP_MAX_FIELD_LEN  128`), add:

```c
// Auth struct type for ClobAuth clear signing
#define MCP_AUTH_STRUCT_TYPE  0x0B

// TLV tag constants for Auth Context (ClobAuth)
#define TAG_MCP_AUTH_LABEL   0x70
#define TAG_MCP_AUTH_ADDRESS 0x71
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && grep -n "MCP_AUTH" src/features/provide_market_context/mcp_tlv.h`
Expected: 3 lines showing the new defines.

- [ ] **Step 3: Commit**

```bash
git add device_app/src/features/provide_market_context/mcp_tlv.h
git commit -m "feat(mcp): add auth TLV constants (0x0B, 0x70, 0x71)"
```

---

### Task 2: Create `auth_context.h` and `auth_context.c`

**Files:**
- Create: `device_app/src/features/provide_market_context/auth_context.h`
- Create: `device_app/src/features/provide_market_context/auth_context.c`

- [ ] **Step 1: Create `auth_context.h`**

Create `device_app/src/features/provide_market_context/auth_context.h`:

```c
#pragma once

#include <stdint.h>
#include <stdbool.h>

#define MCP_AUTH_LABEL_MAX   64
#define MCP_AUTH_ADDRESS_MAX 42  // "0x" + 40 hex chars

typedef struct {
    bool valid;      // payload received and parsed OK
    bool verified;   // signature verified OK
    uint64_t chain_id;
    uint32_t issued_at;
    uint32_t expires_at;
    char auth_label[MCP_AUTH_LABEL_MAX + 1];    // e.g. "Polymarket"
    char auth_address[MCP_AUTH_ADDRESS_MAX + 1]; // e.g. "0x1234...abcd"
} auth_context_t;

// Global auth context state
extern auth_context_t g_auth_context;

// Set when a new auth MCP APDU is received; consumed by eip712_context_init
// so that stale context from a previous signing is cleared.
extern bool g_auth_context_fresh;

void auth_context_clear(void);
bool auth_context_is_valid(void);
void auth_context_consume_or_clear(void);
```

- [ ] **Step 2: Create `auth_context.c`**

Create `device_app/src/features/provide_market_context/auth_context.c`:

```c
#include "auth_context.h"
#include "os.h"

auth_context_t g_auth_context = {0};
bool g_auth_context_fresh = false;

void auth_context_clear(void) {
    explicit_bzero(&g_auth_context, sizeof(g_auth_context));
}

bool auth_context_is_valid(void) {
    return g_auth_context.valid && g_auth_context.verified;
}

/**
 * Called at the start of EIP-712 context init.
 * If a fresh auth MCP was received for this signing session, keep it.
 * Otherwise, clear stale context from a previous signing.
 */
void auth_context_consume_or_clear(void) {
    if (g_auth_context_fresh) {
        // Auth MCP was just received — keep it, mark as consumed
        g_auth_context_fresh = false;
    } else {
        // No fresh auth MCP — clear stale context
        auth_context_clear();
    }
}
```

- [ ] **Step 3: Verify files exist and syntax looks correct**

Run: `ls -la device_app/src/features/provide_market_context/auth_context.*`
Expected: Both `.h` and `.c` files listed.

- [ ] **Step 4: Commit**

```bash
git add device_app/src/features/provide_market_context/auth_context.h device_app/src/features/provide_market_context/auth_context.c
git commit -m "feat(mcp): add auth_context_t state management"
```

---

### Task 3: Create `auth_tlv.h` and `auth_tlv.c`

**Files:**
- Create: `device_app/src/features/provide_market_context/auth_tlv.h`
- Create: `device_app/src/features/provide_market_context/auth_tlv.c`

- [ ] **Step 1: Create `auth_tlv.h`**

Create `device_app/src/features/provide_market_context/auth_tlv.h`:

```c
#pragma once

#include <stdbool.h>
#include "buffer.h"

bool auth_parse_payload(const buffer_t *buf);
```

- [ ] **Step 2: Create `auth_tlv.c`**

Create `device_app/src/features/provide_market_context/auth_tlv.c`.

This follows the exact same X-macro pattern as `mcp_tlv.c`:

```c
#include "auth_context.h"
#include "market_context_keys.h"
#include "mcp_tlv.h"
#include "hash_bytes.h"
#include "tlv_library.h"
#include "tlv_apdu.h"
#include "public_keys.h"
#include "utils.h"
#include "lcx_sha256.h"
#include <string.h>

typedef struct {
    auth_context_t *ctx;
    cx_sha256_t hash_ctx;
    const uint8_t *sig;
    uint8_t sig_size;
    TLV_reception_t received_tags;
} s_auth_parse_ctx;

static bool auth_parse_struct_type(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    UNUSED(pctx);
    return tlv_check_struct_type(data, MCP_AUTH_STRUCT_TYPE);
}

static bool auth_parse_struct_version(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    UNUSED(pctx);
    return tlv_check_struct_version(data, MCP_STRUCT_VERSION);
}

static bool auth_parse_chain_id(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    return tlv_get_chain_id(data, &pctx->ctx->chain_id);
}

static bool auth_parse_issued_at(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    if (data->value.size != 4) return false;
    pctx->ctx->issued_at = (uint32_t) data->value.ptr[0] << 24 |
                            (uint32_t) data->value.ptr[1] << 16 |
                            (uint32_t) data->value.ptr[2] << 8 |
                            (uint32_t) data->value.ptr[3];
    return true;
}

static bool auth_parse_expires_at(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    if (data->value.size != 4) return false;
    pctx->ctx->expires_at = (uint32_t) data->value.ptr[0] << 24 |
                             (uint32_t) data->value.ptr[1] << 16 |
                             (uint32_t) data->value.ptr[2] << 8 |
                             (uint32_t) data->value.ptr[3];
    return true;
}

static bool auth_parse_string_field(const tlv_data_t *data, char *buf, size_t max_len) {
    size_t copy_len = data->value.size < max_len ? data->value.size : max_len;
    memmove(buf, data->value.ptr, copy_len);
    buf[copy_len] = '\0';
    return true;
}

static bool auth_parse_label(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    return auth_parse_string_field(data, pctx->ctx->auth_label, MCP_AUTH_LABEL_MAX);
}

static bool auth_parse_address(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    return auth_parse_string_field(data, pctx->ctx->auth_address, MCP_AUTH_ADDRESS_MAX);
}

static bool auth_parse_signature(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    buffer_t sig = {0};
    if (!get_buffer_from_tlv_data(data,
                                  &sig,
                                  CX_ECDSA_SHA256_SIG_MIN_ASN1_LENGTH,
                                  CX_ECDSA_SHA256_SIG_MAX_ASN1_LENGTH)) {
        PRINTF("[AUTH] DER_SIGNATURE: failed to extract\n");
        return false;
    }
    pctx->sig_size = sig.size;
    pctx->sig = sig.ptr;
    return true;
}

static bool auth_common_handler(const tlv_data_t *data, s_auth_parse_ctx *pctx);

#define AUTH_TAGS(X)                                                                            \
    X(TAG_MCP_STRUCT_TYPE, TAG_STRUCT_TYPE, auth_parse_struct_type, ENFORCE_UNIQUE_TAG)         \
    X(TAG_MCP_STRUCT_VERSION, TAG_STRUCT_VER, auth_parse_struct_version, ENFORCE_UNIQUE_TAG)    \
    X(TAG_MCP_CHAIN_ID, TAG_CHAIN, auth_parse_chain_id, ENFORCE_UNIQUE_TAG)                    \
    X(TAG_MCP_ISSUED_AT, TAG_ISSUED, auth_parse_issued_at, ENFORCE_UNIQUE_TAG)                 \
    X(TAG_MCP_EXPIRES_AT, TAG_EXPIRES, auth_parse_expires_at, ENFORCE_UNIQUE_TAG)              \
    X(TAG_MCP_AUTH_LABEL, TAG_LABEL, auth_parse_label, ENFORCE_UNIQUE_TAG)                     \
    X(TAG_MCP_AUTH_ADDRESS, TAG_ADDR, auth_parse_address, ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_DER_SIGNATURE, TAG_DER_SIG, auth_parse_signature, ENFORCE_UNIQUE_TAG)

DEFINE_TLV_PARSER(AUTH_TAGS, &auth_common_handler, auth_tlv_parser)

static bool auth_common_handler(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    // Hash all tags except the signature itself
    if (data->tag != TAG_MCP_DER_SIGNATURE) {
        hash_nbytes(data->raw.ptr, data->raw.size, (cx_hash_t *) &pctx->hash_ctx);
    }
    return true;
}

static bool auth_verify_signature(const s_auth_parse_ctx *pctx) {
    uint8_t hash[INT256_LENGTH] = {0};

    if (finalize_hash((cx_hash_t *) &pctx->hash_ctx, hash, sizeof(hash)) != true) {
        PRINTF("[AUTH] Failed to finalize hash\n");
        return false;
    }

    return check_signature_with_pubkey(hash,
                                       sizeof(hash),
                                       MCP_ATTESTER_PUBLIC_KEY,
                                       MCP_ATTESTER_PUBLIC_KEY_LEN,
                                       0,
                                       (uint8_t *) pctx->sig,
                                       pctx->sig_size);
}

static bool auth_verify_mandatory_tags(const s_auth_parse_ctx *pctx) {
    return TLV_CHECK_RECEIVED_TAGS(pctx->received_tags,
                                   TAG_STRUCT_TYPE,
                                   TAG_STRUCT_VER,
                                   TAG_CHAIN,
                                   TAG_ISSUED,
                                   TAG_EXPIRES,
                                   TAG_LABEL,
                                   TAG_ADDR,
                                   TAG_DER_SIG);
}

bool auth_parse_payload(const buffer_t *buf) {
    s_auth_parse_ctx pctx = {0};
    pctx.ctx = &g_auth_context;
    auth_context_clear();
    cx_sha256_init(&pctx.hash_ctx);

    if (!auth_tlv_parser(buf, &pctx, &pctx.received_tags)) {
        PRINTF("[AUTH] TLV parse failed\n");
        return false;
    }
    if (!auth_verify_mandatory_tags(&pctx)) {
        PRINTF("[AUTH] Missing mandatory tags\n");
        return false;
    }
    // TTL sanity: expires_at must be strictly after issued_at
    if (g_auth_context.expires_at <= g_auth_context.issued_at) {
        PRINTF("[AUTH] TTL sanity failed: expires_at(%u) <= issued_at(%u)\n",
               g_auth_context.expires_at,
               g_auth_context.issued_at);
        auth_context_clear();
        return false;
    }
    g_auth_context.valid = true;
    if (!auth_verify_signature(&pctx)) {
        PRINTF("[AUTH] Signature verification failed\n");
        auth_context_clear();
        return false;
    }
    g_auth_context.verified = true;
    g_auth_context_fresh = true;
    PRINTF("[AUTH] Valid auth context: %s | %s\n",
           g_auth_context.auth_label,
           g_auth_context.auth_address);
    return true;
}
```

- [ ] **Step 3: Verify files exist**

Run: `ls -la device_app/src/features/provide_market_context/auth_tlv.*`
Expected: Both `.h` and `.c` files listed.

- [ ] **Step 4: Commit**

```bash
git add device_app/src/features/provide_market_context/auth_tlv.h device_app/src/features/provide_market_context/auth_tlv.c
git commit -m "feat(mcp): add auth TLV parser with X-macro pattern"
```

---

### Task 4: Route by struct type in APDU handler

**Files:**
- Modify: `device_app/src/features/provide_market_context/cmd_provide_market_context.c`

- [ ] **Step 1: Update the APDU handler to peek at struct type and dispatch**

Replace the entire contents of `device_app/src/features/provide_market_context/cmd_provide_market_context.c` with:

```c
#include "cmd_provide_market_context.h"
#include "mcp_tlv.h"
#include "auth_tlv.h"
#include "market_context.h"
#include "auth_context.h"
#include "apdu_constants.h"
#include "tlv_apdu.h"

/**
 * Routing callback: peek at the struct type byte in the first TLV tag
 * to decide which parser handles the payload.
 *
 * Layout of first TLV: tag(1) + length(1) + value(1)
 * - tag must be TAG_MCP_STRUCT_TYPE (0x01)
 * - length must be 1
 * - value: 0x0A → order (mcp_parse_payload), 0x0B → auth (auth_parse_payload)
 */
static bool route_by_struct_type(const buffer_t *buf) {
    if (buf->size < 3) {
        PRINTF("[MCP] Payload too short for struct type peek\n");
        return false;
    }

    uint8_t tag = buf->ptr[buf->offset];
    uint8_t len = buf->ptr[buf->offset + 1];
    uint8_t val = buf->ptr[buf->offset + 2];

    if (tag != TAG_MCP_STRUCT_TYPE || len != 1) {
        PRINTF("[MCP] Invalid struct type tag: tag=0x%02X len=%u\n", tag, len);
        return false;
    }

    if (val == MCP_STRUCT_TYPE) {
        return mcp_parse_payload(buf);
    } else if (val == MCP_AUTH_STRUCT_TYPE) {
        return auth_parse_payload(buf);
    } else {
        PRINTF("[MCP] Unknown struct type: 0x%02X\n", val);
        return false;
    }
}

uint16_t handle_provide_market_context(uint8_t p1,
                                       uint8_t p2,
                                       const uint8_t *data,
                                       uint8_t length) {
    UNUSED(p1);
    if (!tlv_from_apdu(p2 == P1_FIRST_CHUNK, length, data, &route_by_struct_type)) {
        PRINTF("[MCP] APDU handler: tlv_from_apdu failed\n");
        return SWO_INCORRECT_DATA;
    }
    return SWO_SUCCESS;
}
```

- [ ] **Step 2: Verify the routing logic**

Run: `grep -n "route_by_struct_type\|MCP_AUTH_STRUCT_TYPE\|auth_parse_payload" device_app/src/features/provide_market_context/cmd_provide_market_context.c`
Expected: References to the routing function, auth struct type, and auth parser.

- [ ] **Step 3: Commit**

```bash
git add device_app/src/features/provide_market_context/cmd_provide_market_context.c
git commit -m "feat(mcp): route APDU by struct type (order vs auth)"
```

---

### Task 5: Inject auth screens in EIP-712 UI

**Files:**
- Modify: `device_app/src/features/sign_message_eip712/ui_logic.c:1081-1094`

- [ ] **Step 1: Add auth_context include**

In `device_app/src/features/sign_message_eip712/ui_logic.c`, find the existing include for `market_context.h` and add the auth include right after it:

Find (near the top of the file):
```c
#include "features/provide_market_context/market_context.h"
```

Add after it:
```c
#include "features/provide_market_context/auth_context.h"
```

- [ ] **Step 2: Add `ui_712_inject_auth_screens()` function**

In `device_app/src/features/sign_message_eip712/ui_logic.c`, find the `ui_712_inject_mcp_screens()` function (ends around line 1081). Add the auth injection function right after it, before `ui_712_end_sign()`:

Find:
```c
    PRINTF("[MCP] Injected 5 MCP UI screens at front\n");
}

/**
 * Used to signal that we are done with reviewing the structs and we can now have
 * the option to approve or reject the signature
 */
void ui_712_end_sign(void) {
```

Replace with:
```c
    PRINTF("[MCP] Injected 5 MCP UI screens at front\n");
}

/**
 * Inject auth context screens (Service + Address) at the BEGINNING of the
 * EIP-712 UI pair list for ClobAuth clear signing.
 */
static void ui_712_inject_auth_screens(void) {
    if (!auth_context_is_valid()) return;

    s_ui_712_pair *service = mcp_alloc_pair("Service", g_auth_context.auth_label);
    s_ui_712_pair *address = mcp_alloc_pair("Address", g_auth_context.auth_address);

    if (!service || !address) {
        PRINTF("[AUTH] Failed to allocate auth UI pairs\n");
        return;
    }

    // Link: Service -> Address -> existing pairs
    ((flist_node_t *) service)->next = (flist_node_t *) address;
    ((flist_node_t *) address)->next = (flist_node_t *) ui_ctx->ui_pairs;
    ui_ctx->ui_pairs = service;

    PRINTF("[AUTH] Injected 2 auth UI screens at front\n");
}

/**
 * Used to signal that we are done with reviewing the structs and we can now have
 * the option to approve or reject the signature
 */
void ui_712_end_sign(void) {
```

- [ ] **Step 3: Call `ui_712_inject_auth_screens()` in `ui_712_end_sign()`**

In `ui_712_end_sign()`, find the line:
```c
    // Inject MCP market context screens at the front of the review
    ui_712_inject_mcp_screens();
```

Replace with:
```c
    // Inject MCP market context screens at the front of the review
    ui_712_inject_mcp_screens();
    ui_712_inject_auth_screens();
```

Only one will inject (the other returns early if its context is not valid).

- [ ] **Step 4: Verify the changes**

Run: `grep -n "inject_auth_screens\|auth_context" device_app/src/features/sign_message_eip712/ui_logic.c`
Expected: Include, function definition, and call site all present.

- [ ] **Step 5: Commit**

```bash
git add device_app/src/features/sign_message_eip712/ui_logic.c
git commit -m "feat(mcp): inject auth clear signing screens (Service + Address)"
```

---

### Task 6: Auth-specific binding check in `commands_712.c`

**Files:**
- Modify: `device_app/src/features/sign_message_eip712/commands_712.c:310-329`

- [ ] **Step 1: Add auth_context include**

In `device_app/src/features/sign_message_eip712/commands_712.c`, find the existing include for `market_context.h` and add the auth include right after it:

Find:
```c
#include "features/provide_market_context/market_context.h"
```

Add after it:
```c
#include "features/provide_market_context/auth_context.h"
```

- [ ] **Step 2: Add auth binding check after the existing MCP binding check**

In `commands_712.c`, find the closing brace of the MCP binding check block (around line 329):

Find:
```c
            } else if (g_eip712_token_id_extracted &&
                       memcmp(g_market_context.token_id,
                              g_eip712_extracted_token_id,
                              INT256_LENGTH) != 0) {
                PRINTF("[MCP] tokenId mismatch between MCP and EIP-712 message\n");
                market_context_clear();
                apdu_response_code = SWO_INCORRECT_DATA;
                ret = false;
            }
        }
```

Add after the closing `}` of the `if (market_context_is_valid())` block:

```c
        // Auth binding: if auth context was provided, verify chainId matches
        if (auth_context_is_valid()) {
            if (eip712_context != NULL &&
                g_auth_context.chain_id != eip712_context->chain_id) {
                PRINTF("[AUTH] chain_id mismatch: AUTH=%llu EIP712=%llu\n",
                       (unsigned long long) g_auth_context.chain_id,
                       (unsigned long long) eip712_context->chain_id);
                auth_context_clear();
                apdu_response_code = SWO_INCORRECT_DATA;
                ret = false;
            }
        }
```

- [ ] **Step 3: Verify the change**

Run: `grep -n "auth_context" device_app/src/features/sign_message_eip712/commands_712.c`
Expected: Include and binding check references.

- [ ] **Step 4: Commit**

```bash
git add device_app/src/features/sign_message_eip712/commands_712.c
git commit -m "feat(mcp): add auth binding check (chain_id only, no tokenId)"
```

---

### Task 7: Add `auth_context_consume_or_clear()` in `context_712.c`

**Files:**
- Modify: `device_app/src/features/sign_message_eip712/context_712.c:12,29`

- [ ] **Step 1: Add auth_context include**

In `device_app/src/features/sign_message_eip712/context_712.c`, find:
```c
#include "features/provide_market_context/market_context.h"
```

Add after it:
```c
#include "features/provide_market_context/auth_context.h"
```

- [ ] **Step 2: Add auth consume_or_clear call**

In `eip712_context_init()`, find:
```c
    // Clear stale MCP context unless a fresh one was just received
    market_context_consume_or_clear();
```

Add after it:
```c
    // Clear stale auth context unless a fresh one was just received
    auth_context_consume_or_clear();
```

- [ ] **Step 3: Verify the change**

Run: `grep -n "auth_context" device_app/src/features/sign_message_eip712/context_712.c`
Expected: Include and consume_or_clear call.

- [ ] **Step 4: Commit**

```bash
git add device_app/src/features/sign_message_eip712/context_712.c
git commit -m "feat(mcp): clear stale auth context on EIP-712 init"
```

---

### Task 8: Auth-aware review titles in `ui_sign_712.c`

**Files:**
- Modify: `device_app/src/nbgl/ui_sign_712.c`

- [ ] **Step 1: Add auth_context include**

In `device_app/src/nbgl/ui_sign_712.c`, find:
```c
#include "features/provide_market_context/market_context.h"
```

Add after it:
```c
#include "features/provide_market_context/auth_context.h"
```

- [ ] **Step 2: Update `ui_712_start_review()` for auth awareness**

In `ui_712_start_review()`, find:
```c
    bool mcp_active = market_context_is_valid();
```

Add after it:
```c
    bool auth_active = auth_context_is_valid();
```

- [ ] **Step 3: Update title suffix**

Find (inside `#ifdef SCREEN_SIZE_WALLET`):
```c
    const char *title_suffix = mcp_active ? " order?" : " typed message?";
```

Replace with:
```c
    const char *tx_check_str_override = NULL;
    const char *title_suffix;
    if (mcp_active) {
        title_suffix = " order?";
    } else if (auth_active) {
        title_suffix = " to Polymarket?";
        tx_check_str_override = "Connect";
    } else {
        title_suffix = " typed message?";
    }
```

- [ ] **Step 4: Update finish message to use override**

Find:
```c
    finish_len += strlen(tx_check_str);
    finish_len += strlen(title_suffix);
    if (!ui_buffers_init(0, 0, finish_len)) {
        return;
    }
    snprintf(g_finishMsg, finish_len, "%s%s", tx_check_str, title_suffix);
```

Replace with:
```c
    const char *finish_prefix = tx_check_str_override ? tx_check_str_override : tx_check_str;
    finish_len += strlen(finish_prefix);
    finish_len += strlen(title_suffix);
    if (!ui_buffers_init(0, 0, finish_len)) {
        return;
    }
    snprintf(g_finishMsg, finish_len, "%s%s", finish_prefix, title_suffix);
```

- [ ] **Step 5: Update the `#else` branch (non-wallet) similarly**

Find:
```c
    const char *title_suffix = mcp_active ? " order" : " message";
```

Replace with:
```c
    const char *title_suffix;
    if (mcp_active) {
        title_suffix = " order";
    } else if (auth_active) {
        title_suffix = " to Polymarket";
    } else {
        title_suffix = " message";
    }
```

- [ ] **Step 6: Update skippable operation check**

Find:
```c
        if (N_storage.verbose_eip712 || mcp_active) {
```

Replace with:
```c
        if (N_storage.verbose_eip712 || mcp_active || auth_active) {
```

- [ ] **Step 7: Update review title and icon**

Find:
```c
    const char *review_title = mcp_active ? "Review order" : "Review typed message";

    nbgl_useCaseAdvancedReview(operationType,
                               g_pairsList,
                               mcp_active ? get_app_icon(false) : &ICON_APP_REVIEW,
                               review_title,
```

Replace with:
```c
    const char *review_title;
    if (mcp_active) {
        review_title = "Review order";
    } else if (auth_active) {
        review_title = "Connect to Polymarket";
    } else {
        review_title = "Review typed message";
    }

    nbgl_useCaseAdvancedReview(operationType,
                               g_pairsList,
                               (mcp_active || auth_active) ? get_app_icon(false) : &ICON_APP_REVIEW,
                               review_title,
```

- [ ] **Step 8: Verify the changes**

Run: `grep -n "auth_active\|auth_context" device_app/src/nbgl/ui_sign_712.c`
Expected: Include, `auth_active` variable, and all conditional branches.

- [ ] **Step 9: Commit**

```bash
git add device_app/src/nbgl/ui_sign_712.c
git commit -m "feat(mcp): auth-aware review titles and Connect button"
```

---

### Task 9: Frontend — Add ClobAuth detection and auth context builder

**Files:**
- Modify: `apps/web/src/lib/polymarket-context.ts`

- [ ] **Step 1: Add `isClobAuth()` function**

In `apps/web/src/lib/polymarket-context.ts`, after the `isPolymarketOrder()` function (after line 31), add:

```typescript
/**
 * Returns true if the given EIP-712 typed data is a ClobAuth message.
 */
export function isClobAuth(
  primaryType: string,
  domain: Record<string, unknown>
): boolean {
  return primaryType === "ClobAuth" && Number(domain.chainId) === 137;
}
```

- [ ] **Step 2: Add `AuthContextInfo` interface and `buildAuthContext()` function**

After the new `isClobAuth()` function, add:

```typescript
export interface AuthContextInfo {
  type: "auth";
  chainId: number;
  label: string;
  address: string;
}

/**
 * Build auth context info from a ClobAuth EIP-712 typed data message.
 */
export function buildAuthContext(
  message: Record<string, unknown>,
  chainId: number
): AuthContextInfo {
  return {
    type: "auth",
    chainId,
    label: "Polymarket",
    address: String(message.address),
  };
}
```

- [ ] **Step 3: Update `fetchSignedMCPPayload()` to accept auth context**

Replace the existing `fetchSignedMCPPayload()` function with:

```typescript
/**
 * Fetch a signed MCP TLV payload from the backend attester service.
 * Accepts either a PolymarketMarketInfo (order) or AuthContextInfo (auth).
 */
export async function fetchSignedMCPPayload(
  info: PolymarketMarketInfo | AuthContextInfo
): Promise<Uint8Array> {
  const body = info.type === "auth"
    ? {
        type: "auth",
        chainId: info.chainId,
        label: info.label,
        address: info.address,
      }
    : {
        tokenId: info.tokenId.toString(),
        chainId: info.chainId,
        marketName: info.marketName,
        marketOutcome: info.marketOutcome,
        marketAmount: info.marketAmount,
        marketShares: info.marketShares,
        marketPrice: info.marketPrice,
      };

  const res = await fetch(`${API_BASE}/api/market-context/sign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`MCP signing failed: ${res.status}`);
  }
  const { payload } = await res.json();
  return Uint8Array.from(
    payload.match(/.{1,2}/g)!.map((byte: string) => parseInt(byte, 16))
  );
}
```

**Note:** The existing `PolymarketMarketInfo` type does NOT have a `type` field. Add one to distinguish at runtime. Find the `PolymarketMarketInfo` interface and add:

```typescript
export interface PolymarketMarketInfo {
  type?: "order";  // Add this line (optional for backward compat)
  tokenId: bigint;
  // ... rest unchanged
```

- [ ] **Step 4: Verify the changes**

Run: `grep -n "isClobAuth\|AuthContextInfo\|buildAuthContext\|type.*auth" apps/web/src/lib/polymarket-context.ts`
Expected: All new functions and types visible.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/polymarket-context.ts
git commit -m "feat(web): add ClobAuth detection and auth context builder"
```

---

### Task 10: Frontend — Add ClobAuth MCP flow in `signTypedDataV4()`

**Files:**
- Modify: `apps/web/src/lib/ledger-provider.tsx:1457-1474`

- [ ] **Step 1: Add import for new functions**

In `apps/web/src/lib/ledger-provider.tsx`, find the existing import:

```typescript
import { isPolymarketOrder, buildPolymarketContext, fetchSignedMCPPayload } from "./polymarket-context";
```

Replace with:

```typescript
import { isPolymarketOrder, isClobAuth, buildPolymarketContext, buildAuthContext, fetchSignedMCPPayload } from "./polymarket-context";
```

- [ ] **Step 2: Add ClobAuth detection after Polymarket order detection**

In `signTypedDataV4()`, find the closing brace of the Polymarket order block (around line 1474):

```typescript
			if (isPolymarketOrder(parsed.primaryType, parsed.domain as Record<string, unknown>)) {
				try {
					console.log("[MCP] Building polymarket context...");
					const mcpInfo = await buildPolymarketContext(
						parsed.message,
						Number(parsed.domain.chainId ?? 137),
					);
					console.log("[MCP] Context built:", mcpInfo);
					mcpPayload = await fetchSignedMCPPayload(mcpInfo);
					console.log("[MCP] Payload fetched, length:", mcpPayload.length);
				} catch (e) {
					console.warn("[MCP] Failed to fetch market context, signing without clear screens:", e);
				}
			}
```

Add right after this block:

```typescript
			// MCP: pre-fetch auth context for ClobAuth messages
			if (!mcpPayload && isClobAuth(parsed.primaryType, parsed.domain as Record<string, unknown>)) {
				try {
					console.log("[MCP] Building auth context for ClobAuth...");
					const authInfo = buildAuthContext(
						parsed.message,
						Number(parsed.domain.chainId ?? 137),
					);
					console.log("[MCP] Auth context built:", authInfo);
					mcpPayload = await fetchSignedMCPPayload(authInfo);
					console.log("[MCP] Auth payload fetched, length:", mcpPayload.length);
				} catch (e) {
					console.warn("[MCP] Failed to fetch auth context, signing without clear screens:", e);
				}
			}
```

- [ ] **Step 3: Verify the changes**

Run: `grep -n "isClobAuth\|buildAuthContext\|ClobAuth" apps/web/src/lib/ledger-provider.tsx`
Expected: Import and detection block visible.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/ledger-provider.tsx
git commit -m "feat(web): detect ClobAuth and send auth MCP before signing"
```

---

### Task 11: Backend — Handle `type: "auth"` in TLV builder

**Files:**
- Modify: `apps/web/api/market-context/sign.ts`

- [ ] **Step 1: Add auth tag constants and struct type**

In `apps/web/api/market-context/sign.ts`, find:

```typescript
const TAG = {
  STRUCT_TYPE: 0x01,
  STRUCT_VERSION: 0x02,
  CHAIN_ID: 0x23,
  TOKEN_ID: 0x60,
  ISSUED_AT: 0x61,
  EXPIRES_AT: 0x62,
  ATTESTER_ID: 0x63,
  MARKET_NAME: 0x64,
  MARKET_OUTCOME: 0x65,
  MARKET_AMOUNT: 0x66,
  MARKET_SHARES: 0x67,
  MARKET_PRICE: 0x68,
  DER_SIGNATURE: 0x15,
};
```

Replace with:

```typescript
const TAG = {
  STRUCT_TYPE: 0x01,
  STRUCT_VERSION: 0x02,
  CHAIN_ID: 0x23,
  TOKEN_ID: 0x60,
  ISSUED_AT: 0x61,
  EXPIRES_AT: 0x62,
  ATTESTER_ID: 0x63,
  MARKET_NAME: 0x64,
  MARKET_OUTCOME: 0x65,
  MARKET_AMOUNT: 0x66,
  MARKET_SHARES: 0x67,
  MARKET_PRICE: 0x68,
  AUTH_LABEL: 0x70,
  AUTH_ADDRESS: 0x71,
  DER_SIGNATURE: 0x15,
};

const MCP_AUTH_STRUCT_TYPE = 0x0b;
```

- [ ] **Step 2: Extract a `signPayload()` helper**

Find the signing block near the end of the `handler` function:

```typescript
  // Sign SHA-256(payload) with SECP256K1 private key (DER format)
  const privKeyPem = process.env.MCP_ATTESTER_PRIVATE_KEY_PEM;
  if (!privKeyPem) {
    return res.status(500).json({ error: "Attester key not configured" });
  }
  // Support pipe-separated PEM (for single-line env vars)
  const pemContent = privKeyPem.replace(/\|/g, "\n");
  const sign = createSign("SHA256");
  sign.update(payload);
  const sig = sign.sign(pemContent);

  payload = Buffer.concat([payload, tlvField(TAG.DER_SIGNATURE, sig)]);

  return res.status(200).json({ payload: payload.toString("hex") });
```

Replace the entire `handler` function with:

```typescript
function signAndAppend(payload: Buffer): Buffer | null {
  const privKeyPem = process.env.MCP_ATTESTER_PRIVATE_KEY_PEM;
  if (!privKeyPem) return null;
  const pemContent = privKeyPem.replace(/\|/g, "\n");
  const sign = createSign("SHA256");
  sign.update(payload);
  const sig = sign.sign(pemContent);
  return Buffer.concat([payload, tlvField(TAG.DER_SIGNATURE, sig)]);
}

function buildOrderPayload(body: Record<string, unknown>): Buffer {
  const { tokenId, chainId, marketName, marketOutcome, marketAmount, marketShares, marketPrice } = body;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;

  const tokenIdBuf = Buffer.from(
    BigInt(tokenId as string).toString(16).padStart(64, "0"),
    "hex"
  );
  const chainIdBuf = Buffer.alloc(8);
  chainIdBuf.writeBigUInt64BE(BigInt(chainId as number));
  const issuedAtBuf = Buffer.alloc(4);
  issuedAtBuf.writeUInt32BE(now);
  const expiresAtBuf = Buffer.alloc(4);
  expiresAtBuf.writeUInt32BE(expiresAt);

  return Buffer.concat([
    tlvField(TAG.STRUCT_TYPE, Buffer.from([MCP_STRUCT_TYPE])),
    tlvField(TAG.STRUCT_VERSION, Buffer.from([MCP_STRUCT_VERSION])),
    tlvField(TAG.CHAIN_ID, chainIdBuf),
    tlvField(TAG.TOKEN_ID, tokenIdBuf),
    tlvField(TAG.ISSUED_AT, issuedAtBuf),
    tlvField(TAG.EXPIRES_AT, expiresAtBuf),
    tlvField(TAG.ATTESTER_ID, Buffer.from([0x00])),
    tlvField(TAG.MARKET_NAME, Buffer.from(String(marketName).slice(0, 128))),
    tlvField(TAG.MARKET_OUTCOME, Buffer.from(String(marketOutcome).slice(0, 16))),
    tlvField(TAG.MARKET_AMOUNT, Buffer.from(String(marketAmount).slice(0, 32))),
    tlvField(TAG.MARKET_SHARES, Buffer.from(String(marketShares).slice(0, 32))),
    tlvField(TAG.MARKET_PRICE, Buffer.from(String(marketPrice).slice(0, 32))),
  ]);
}

function buildAuthPayload(body: Record<string, unknown>): Buffer {
  const { chainId, label, address } = body;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;

  const chainIdBuf = Buffer.alloc(8);
  chainIdBuf.writeBigUInt64BE(BigInt(chainId as number));
  const issuedAtBuf = Buffer.alloc(4);
  issuedAtBuf.writeUInt32BE(now);
  const expiresAtBuf = Buffer.alloc(4);
  expiresAtBuf.writeUInt32BE(expiresAt);

  return Buffer.concat([
    tlvField(TAG.STRUCT_TYPE, Buffer.from([MCP_AUTH_STRUCT_TYPE])),
    tlvField(TAG.STRUCT_VERSION, Buffer.from([MCP_STRUCT_VERSION])),
    tlvField(TAG.CHAIN_ID, chainIdBuf),
    tlvField(TAG.ISSUED_AT, issuedAtBuf),
    tlvField(TAG.EXPIRES_AT, expiresAtBuf),
    tlvField(TAG.AUTH_LABEL, Buffer.from(String(label).slice(0, 64))),
    tlvField(TAG.AUTH_ADDRESS, Buffer.from(String(address).slice(0, 42))),
  ]);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { type } = req.body;
  let payload: Buffer;

  if (type === "auth") {
    const { chainId, label, address } = req.body;
    if (!chainId || !label || !address) {
      return res.status(400).json({ error: "Missing required auth fields" });
    }
    payload = buildAuthPayload(req.body);
  } else {
    const { tokenId, chainId, marketName, marketOutcome, marketAmount, marketShares, marketPrice } =
      req.body;
    if (!tokenId || !chainId || !marketName || !marketOutcome || !marketAmount || !marketShares || !marketPrice) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    payload = buildOrderPayload(req.body);
  }

  const signed = signAndAppend(payload);
  if (!signed) {
    return res.status(500).json({ error: "Attester key not configured" });
  }

  return res.status(200).json({ payload: signed.toString("hex") });
}
```

- [ ] **Step 3: Verify the changes**

Run: `grep -n "AUTH_LABEL\|AUTH_ADDRESS\|buildAuthPayload\|type.*auth" apps/web/api/market-context/sign.ts`
Expected: New tags, auth builder, and type routing visible.

- [ ] **Step 4: Commit**

```bash
git add apps/web/api/market-context/sign.ts
git commit -m "feat(api): handle type auth in MCP TLV builder"
```

---

### Task 12: Verify TypeScript compilation

**Files:** None (verification only)

- [ ] **Step 1: Check TypeScript compiles**

Run: `cd /Users/gregz./dev/ethglobal2026 && npx tsc --noEmit --project apps/web/tsconfig.json 2>&1 | head -30`
Expected: No errors related to the modified files, or only pre-existing errors.

- [ ] **Step 2: If there are type errors, fix them**

Common issues:
- `PolymarketMarketInfo` might need the `type?: "order"` field added
- `fetchSignedMCPPayload` parameter type union might need adjustment

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve TypeScript compilation errors from auth changes"
```

---
