# Polymarket Clear Signing (MCP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Market Context Protocol (MCP) APDU channel to `device_app` so Ledger devices display human-readable Polymarket market data before signing EIP-712 `Order` structs.

**Architecture:** A new APDU `INS_PROVIDE_MARKET_CONTEXT (0x3A)` carries TLV-encoded, cryptographically-attested market context (question, outcome, amount) to the device before the EIP-712 sign. The device verifies the attestation and injects MCP screens into the EIP-712 review flow. The EIP-712 hash is unchanged. A TypeScript context loader in `apps/web` fetches Polymarket CLOB API data and sends the APDU.

**Tech Stack:** C (device_app, Ledger SDK), Python (ragger tests, TLV builder), TypeScript/React (apps/web, @ledgerhq/device-management-kit)

---

## File Map

### New device_app C files
- `src/apdu_constants.h` — add `INS_PROVIDE_MARKET_CONTEXT = 0x3A`
- `src/main.c` — add dispatch case + cleanup hook
- `src/features/provide_market_context/mcp_tlv.h` — TLV tag constants
- `src/features/provide_market_context/mcp_tlv.c` — TLV parser (mirrors tx_simulation pattern)
- `src/features/provide_market_context/cmd_provide_market_context.h` — handler declaration
- `src/features/provide_market_context/cmd_provide_market_context.c` — APDU handler
- `src/features/provide_market_context/market_context.h` — state struct + API
- `src/features/provide_market_context/market_context.c` — state lifecycle
- `src/features/provide_market_context/market_context_keys.h` — attester pubkey
- `src/features/provide_market_context/market_context_keys.c` — key definition
- `src/features/sign_message_eip712/field_hash.c` — extract tokenId for binding (modify)
- `src/features/sign_message_eip712/commands_712.c` — binding check at sign time (modify)
- `src/features/sign_message_eip712/ui_logic.c` — inject MCP UI pairs (modify)

### New Python/test files
- `client/src/ledger_app_clients/ethereum/keychain/polymarket_mcp.pem` — test signing key
- `client/src/ledger_app_clients/ethereum/keychain.py` — add `POLYMARKET_MCP` key (modify)
- `client/src/ledger_app_clients/ethereum/tlv.py` — add MCP TLV tags (modify)
- `client/src/ledger_app_clients/ethereum/market_context.py` — MCP TLV serializer (new)
- `client/src/ledger_app_clients/ethereum/command_builder.py` — add `provide_market_context()` (modify)
- `client/src/ledger_app_clients/ethereum/client.py` — add `provide_market_context()` method (modify)
- `tests/ragger/test_market_context.py` — integration tests (new)

### New web files
- `apps/web/src/lib/polymarket-context.ts` — Polymarket CLOB API fetcher (new)
- `apps/web/src/lib/ledger-provider.tsx` — send MCP before EIP-712 sign (modify)

---

## Phase 1: Device App (C)

### Task 1: Baseline ragger test for vanilla Polymarket EIP-712

**Files:**
- Create: `device_app/tests/ragger/test_market_context.py`

This test verifies that a Polymarket `Order` typed data signs correctly WITHOUT MCP, establishing our non-regression baseline.

- [ ] **Step 1: Create test file with baseline test**

```python
# device_app/tests/ragger/test_market_context.py
import pytest
from web3 import Web3
from ragger.navigator import NavInsID

# Polymarket Order EIP-712 domain (Polygon mainnet, CTFExchange)
POLYMARKET_DOMAIN = {
    "name": "ClobAuthDomain",
    "version": "1",
    "chainId": 137,
}
POLYMARKET_ORDER_TYPE = {
    "Order": [
        {"name": "salt", "type": "uint256"},
        {"name": "maker", "type": "address"},
        {"name": "signer", "type": "address"},
        {"name": "taker", "type": "address"},
        {"name": "tokenId", "type": "uint256"},
        {"name": "makerAmount", "type": "uint256"},
        {"name": "takerAmount", "type": "uint256"},
        {"name": "expiration", "type": "uint256"},
        {"name": "nonce", "type": "uint256"},
        {"name": "feeRateBps", "type": "uint256"},
        {"name": "side", "type": "uint8"},
        {"name": "signatureType", "type": "uint8"},
    ]
}
SAMPLE_ORDER = {
    "salt": 12345,
    "maker": "0x1234567890123456789012345678901234567890",
    "signer": "0x1234567890123456789012345678901234567890",
    "taker": "0x0000000000000000000000000000000000000000",
    "tokenId": 0xDEADBEEFCAFEBABE1234567890ABCDEF12345678901234567890ABCDEF12345678,
    "makerAmount": 50000000,   # 50 USDC (6 decimals)
    "takerAmount": 76923077,   # ~77M YES shares
    "expiration": 0,
    "nonce": 0,
    "feeRateBps": 0,
    "side": 0,          # BUY
    "signatureType": 0,  # EOA
}


def test_polymarket_eip712_baseline(backend, firmware, navigator, test_name, default_screenshot_path):
    """Polymarket Order signs successfully without MCP (baseline)."""
    from ledger_app_clients.ethereum.client import EthAppClient
    from ledger_app_clients.ethereum.command_builder import SignMode
    from ragger.bip import calculate_public_key_and_chaincode, CurveChoice

    app_client = EthAppClient(backend)
    BIP32_PATH = "m/44'/60'/0'/0/0"

    with app_client.sign_typed_data(
        BIP32_PATH,
        POLYMARKET_DOMAIN,
        POLYMARKET_ORDER_TYPE,
        SAMPLE_ORDER,
        mode=SignMode.NEW,
    ):
        navigator.navigate_and_compare(
            default_screenshot_path,
            test_name,
            [NavInsID.USE_CASE_REVIEW_CONFIRM],
        )
```

- [ ] **Step 2: Run baseline test to verify it passes**

```bash
cd device_app
pytest tests/ragger/test_market_context.py::test_polymarket_eip712_baseline -v \
  --device nanosp 2>&1 | tail -20
```

Expected: `PASSED` (confirms EIP-712 baseline works before any changes)

- [ ] **Step 3: Commit baseline test**

```bash
git add tests/ragger/test_market_context.py
git commit -m "test: add Polymarket EIP-712 baseline non-regression test"
```

---

### Task 2: Generate attester test keypair

**Files:**
- Create: `device_app/client/src/ledger_app_clients/ethereum/keychain/polymarket_mcp.pem`
- Modify: `device_app/client/src/ledger_app_clients/ethereum/keychain.py`

- [ ] **Step 1: Generate SECP256K1 test keypair**

```bash
cd device_app/client/src/ledger_app_clients/ethereum/keychain
python3 - <<'EOF'
from ecdsa import SigningKey, SECP256k1
sk = SigningKey.generate(curve=SECP256k1)
with open("polymarket_mcp.pem", "w") as f:
    f.write(sk.to_pem().decode())
vk = sk.get_verifying_key()
pub = b'\x04' + vk.to_string()
print("Public key bytes (for market_context_keys.c):")
print(', '.join(f'0x{b:02x}' for b in pub))
print(f"Length: {len(pub)}")
EOF
```

Copy the printed public key bytes — you'll need them in Task 5.

- [ ] **Step 2: Add `POLYMARKET_MCP` to `Key` enum in `keychain.py`**

In `device_app/client/src/ledger_app_clients/ethereum/keychain.py`, add after `GATING = auto()`:

```python
class Key(Enum):
    CAL = auto()
    TRUSTED_NAME = auto()
    SET_PLUGIN = auto()
    NFT = auto()
    CALLDATA = auto()
    NETWORK = auto()
    TRANSACTION_CHECKS = auto()
    SAFE = auto()
    GATING = auto()
    POLYMARKET_MCP = auto()  # ← add this line
```

- [ ] **Step 3: Commit keypair and keychain update**

```bash
git add keychain/polymarket_mcp.pem \
        client/src/ledger_app_clients/ethereum/keychain.py
git commit -m "feat: add Polymarket MCP test signing keypair"
```

---

### Task 3: MCP TLV tags and Python serializer

**Files:**
- Modify: `device_app/client/src/ledger_app_clients/ethereum/tlv.py`
- Create: `device_app/client/src/ledger_app_clients/ethereum/market_context.py`

- [ ] **Step 1: Add MCP tags to `tlv.py`**

In `device_app/client/src/ledger_app_clients/ethereum/tlv.py`, add to `FieldTag` enum:

```python
class FieldTag(IntEnum):
    STRUCT_TYPE = 0x01
    STRUCT_VERSION = 0x02
    CHALLENGE = 0x12
    DER_SIGNATURE = 0x15
    ADDRESS = 0x22
    CHAIN_ID = 0x23
    TICKER = 0x24
    TX_HASH = 0x27
    DOMAIN_HASH = 0x28
    SELECTOR = 0x40
    BLOCKCHAIN_FAMILY = 0x51
    NETWORK_NAME = 0x52
    NETWORK_ICON_HASH = 0x53
    TX_CHECKS_NORMALIZED_RISK = 0x80
    TX_CHECKS_NORMALIZED_CATEGORY = 0x81
    MESSAGE = 0x82
    TINY_URL = 0x83
    TX_TYPE = 0x84
    THRESHOLD = 0xa0,
    SIGNERS_COUNT = 0xa1,
    LESM_ROLE = 0xa2,
    # MCP tags
    MCP_TOKEN_ID = 0x60
    MCP_ISSUED_AT = 0x61
    MCP_EXPIRES_AT = 0x62
    MCP_ATTESTER_ID = 0x63
    MCP_MARKET_NAME = 0x64
    MCP_MARKET_OUTCOME = 0x65
    MCP_MARKET_AMOUNT = 0x66
```

- [ ] **Step 2: Create `market_context.py`**

```python
# device_app/client/src/ledger_app_clients/ethereum/market_context.py
import time
from .tlv import TlvSerializable, FieldTag
from .keychain import sign_data, Key

MCP_STRUCT_TYPE = 0x0A
MCP_STRUCT_VERSION = 0x01


class MarketContext(TlvSerializable):
    """TLV-serializable Polymarket MCP attestation payload."""

    def __init__(
        self,
        token_id: bytes,           # 32 bytes
        chain_id: int,             # Polygon = 137
        market_name: str,          # "Will Trump win 2026?"
        market_outcome: str,       # "YES" or "NO"
        market_amount: str,        # "50.00 USDC"
        attester_id: int = 0,
        ttl_seconds: int = 300,
    ) -> None:
        assert len(token_id) == 32, "token_id must be 32 bytes"
        self.token_id = token_id
        self.chain_id = chain_id
        self.market_name = market_name
        self.market_outcome = market_outcome
        self.market_amount = market_amount
        self.attester_id = attester_id
        self.issued_at = int(time.time())
        self.expires_at = self.issued_at + ttl_seconds

    def serialize(self) -> bytes:
        payload: bytes = b""
        payload += self.serialize_field(FieldTag.STRUCT_TYPE, MCP_STRUCT_TYPE)
        payload += self.serialize_field(FieldTag.STRUCT_VERSION, MCP_STRUCT_VERSION)
        payload += self.serialize_field(FieldTag.CHAIN_ID, self.chain_id.to_bytes(8, "big"))
        payload += self.serialize_field(FieldTag.MCP_TOKEN_ID, self.token_id)
        payload += self.serialize_field(FieldTag.MCP_ISSUED_AT, self.issued_at.to_bytes(4, "big"))
        payload += self.serialize_field(FieldTag.MCP_EXPIRES_AT, self.expires_at.to_bytes(4, "big"))
        payload += self.serialize_field(FieldTag.MCP_ATTESTER_ID, self.attester_id)
        payload += self.serialize_field(FieldTag.MCP_MARKET_NAME, self.market_name.encode("utf-8"))
        payload += self.serialize_field(FieldTag.MCP_MARKET_OUTCOME, self.market_outcome.encode("utf-8"))
        payload += self.serialize_field(FieldTag.MCP_MARKET_AMOUNT, self.market_amount.encode("utf-8"))
        # Sign all tags before DER_SIGNATURE
        payload += self.serialize_field(
            FieldTag.DER_SIGNATURE,
            sign_data(Key.POLYMARKET_MCP, payload)
        )
        return payload
```

- [ ] **Step 3: Verify serializer runs without error**

```bash
cd device_app/client/src/ledger_app_clients/ethereum
python3 - <<'EOF'
from market_context import MarketContext
ctx = MarketContext(
    token_id=bytes(32),
    chain_id=137,
    market_name="Will Trump win the 2026 midterms?",
    market_outcome="YES",
    market_amount="50.00 USDC",
)
blob = ctx.serialize()
print(f"Serialized MCP blob: {len(blob)} bytes")
print(blob.hex())
EOF
```

Expected: prints a hex blob of ~150–200 bytes, no exceptions.

- [ ] **Step 4: Commit TLV additions**

```bash
git add client/src/ledger_app_clients/ethereum/tlv.py \
        client/src/ledger_app_clients/ethereum/market_context.py
git commit -m "feat: add MCP TLV tags and Python serializer"
```

---

### Task 4: Add `provide_market_context` to command_builder and client

**Files:**
- Modify: `device_app/client/src/ledger_app_clients/ethereum/command_builder.py`
- Modify: `device_app/client/src/ledger_app_clients/ethereum/client.py`

- [ ] **Step 1: Add `PROVIDE_MARKET_CONTEXT` to `InsType` enum in `command_builder.py`**

In `command_builder.py`, add after `PROVIDE_GATING = 0x38`:

```python
class InsType(IntEnum):
    # ... existing entries ...
    PROVIDE_GATING = 0x38
    PROVIDE_MARKET_CONTEXT = 0x3A  # ← add this line
```

- [ ] **Step 2: Add `provide_market_context()` builder method to `CommandBuilder`**

At the end of the `CommandBuilder` class (after `provide_gating`):

```python
    def provide_market_context(self, tlv_payload: bytes) -> list[bytes]:
        return self.common_tlv_serialize(
            InsType.PROVIDE_MARKET_CONTEXT,
            tlv_payload,
            p1l=[0x00],
            p2l=[P1Type.FIRST_CHUNK, P1Type.FOLLOWING_CHUNK],
        )
```

- [ ] **Step 3: Add `provide_market_context()` to `EthAppClient` in `client.py`**

After `provide_gating` method:

```python
    def provide_market_context(self, mcp: "MarketContext") -> RAPDU:
        """Send INS_PROVIDE_MARKET_CONTEXT (0x3A) with attested market context."""
        from .market_context import MarketContext
        chunks = self._cmd_builder.provide_market_context(mcp.serialize())
        response = RAPDU(0x9000, b"")
        for chunk in chunks:
            response = self._backend.exchange_raw(chunk)
        return response
```

- [ ] **Step 4: Commit builder changes**

```bash
git add client/src/ledger_app_clients/ethereum/command_builder.py \
        client/src/ledger_app_clients/ethereum/client.py
git commit -m "feat: add provide_market_context to Python command builder and client"
```

---

### Task 5: C header files — APDU constant + MCP TLV + state

**Files:**
- Modify: `device_app/src/apdu_constants.h`
- Create: `device_app/src/features/provide_market_context/mcp_tlv.h`
- Create: `device_app/src/features/provide_market_context/market_context.h`
- Create: `device_app/src/features/provide_market_context/market_context_keys.h`

- [ ] **Step 1: Add `INS_PROVIDE_MARKET_CONTEXT` to `apdu_constants.h`**

In `device_app/src/apdu_constants.h`, after `INS_PROVIDE_GATING 0x38`:

```c
#define INS_PROVIDE_GATING              0x38
#define INS_PROVIDE_MARKET_CONTEXT      0x3A  // ← add this line
```

Also add to `INS_STR` macro after the gating entry:

```c
     : x == INS_PROVIDE_GATING              ? "PROVIDE_GATING"              \
     : x == INS_PROVIDE_MARKET_CONTEXT      ? "PROVIDE_MARKET_CONTEXT"      \
                                            : "Unknown")
```

And declare the handler at the bottom of `apdu_constants.h`:

```c
uint16_t handle_provide_market_context(uint8_t p1,
                                       uint8_t p2,
                                       const uint8_t *data,
                                       uint8_t length);
```

- [ ] **Step 2: Create `mcp_tlv.h`**

```c
// device_app/src/features/provide_market_context/mcp_tlv.h
#pragma once

#include <stdint.h>
#include <stdbool.h>

#define MCP_STRUCT_TYPE     0x0A
#define MCP_STRUCT_VERSION  0x01
#define MCP_MAX_PAYLOAD     1024
#define MCP_MAX_FIELD_LEN    128

// TLV tag constants for Market Context Protocol
#define TAG_MCP_STRUCT_TYPE       0x01
#define TAG_MCP_STRUCT_VERSION    0x02
#define TAG_MCP_CHAIN_ID          0x23
#define TAG_MCP_TOKEN_ID          0x60
#define TAG_MCP_ISSUED_AT         0x61
#define TAG_MCP_EXPIRES_AT        0x62
#define TAG_MCP_ATTESTER_ID       0x63
#define TAG_MCP_MARKET_NAME       0x64
#define TAG_MCP_MARKET_OUTCOME    0x65
#define TAG_MCP_MARKET_AMOUNT     0x66
#define TAG_MCP_DER_SIGNATURE     0x15
```

- [ ] **Step 3: Create `market_context.h`**

```c
// device_app/src/features/provide_market_context/market_context.h
#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "common_utils.h"

#define MCP_MARKET_NAME_MAX    128
#define MCP_MARKET_OUTCOME_MAX  16
#define MCP_MARKET_AMOUNT_MAX   32

typedef struct {
    bool valid;       // payload received and parsed OK
    bool verified;    // signature verified OK
    uint64_t chain_id;
    uint8_t  token_id[INT256_LENGTH];
    uint32_t issued_at;
    uint32_t expires_at;
    uint8_t  attester_id;
    char market_name[MCP_MARKET_NAME_MAX + 1];
    char market_outcome[MCP_MARKET_OUTCOME_MAX + 1];
    char market_amount[MCP_MARKET_AMOUNT_MAX + 1];
} market_context_t;

// Global MCP state (like TX_SIMULATION)
extern market_context_t g_market_context;

void market_context_clear(void);
bool market_context_is_valid(void);
```

- [ ] **Step 4: Create `market_context_keys.h`**

Replace `<PUBLIC_KEY_BYTES>` with the output of the python keygen command from Task 2.

```c
// device_app/src/features/provide_market_context/market_context_keys.h
#pragma once

#include <stdint.h>

// Uncompressed SECP256K1 public key for the MCP test attester (0x04 + 64 bytes = 65 bytes)
// Generated from: device_app/client/src/ledger_app_clients/ethereum/keychain/polymarket_mcp.pem
static const uint8_t MCP_ATTESTER_PUBLIC_KEY[] = {
    // PASTE THE 65 BYTES FROM TASK 2 KEYGEN OUTPUT HERE
    // Example format (replace with actual bytes):
    // 0x04, 0xAB, 0xCD, ...
    <PUBLIC_KEY_BYTES>
};

#define MCP_ATTESTER_PUBLIC_KEY_LEN sizeof(MCP_ATTESTER_PUBLIC_KEY)
```

- [ ] **Step 5: Commit headers**

```bash
git add src/apdu_constants.h \
        src/features/provide_market_context/mcp_tlv.h \
        src/features/provide_market_context/market_context.h \
        src/features/provide_market_context/market_context_keys.h
git commit -m "feat: add MCP headers — APDU constant, TLV tags, context struct, attester key"
```

---

### Task 6: C implementation — state and TLV parser

**Files:**
- Create: `device_app/src/features/provide_market_context/market_context.c`
- Create: `device_app/src/features/provide_market_context/mcp_tlv.c`

- [ ] **Step 1: Create `market_context.c`**

```c
// device_app/src/features/provide_market_context/market_context.c
#include "market_context.h"
#include "os.h"

market_context_t g_market_context = {0};

void market_context_clear(void) {
    explicit_bzero(&g_market_context, sizeof(g_market_context));
}

bool market_context_is_valid(void) {
    return g_market_context.valid && g_market_context.verified;
}
```

- [ ] **Step 2: Create `mcp_tlv.c` (TLV parser)**

This mirrors `cmd_get_tx_simulation.c`. Study that file for the full pattern — below is the MCP version:

```c
// device_app/src/features/provide_market_context/mcp_tlv.c
#include "market_context.h"
#include "market_context_keys.h"
#include "mcp_tlv.h"
#include "hash_bytes.h"
#include "tlv_library.h"
#include "tlv_apdu.h"
#include "ledger_pki.h"
#include "public_keys.h"
#include "utils.h"
#include "lcx_sha256.h"
#include <string.h>

typedef struct {
    market_context_t *ctx;
    cx_sha256_t hash_ctx;
    const uint8_t *sig;
    uint8_t sig_size;
    TLV_reception_t received_tags;
} s_mcp_parse_ctx;

static bool parse_struct_type(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    UNUSED(pctx);
    return tlv_check_struct_type(data, MCP_STRUCT_TYPE);
}

static bool parse_struct_version(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    UNUSED(pctx);
    return tlv_check_struct_version(data, MCP_STRUCT_VERSION);
}

static bool parse_chain_id(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    return tlv_get_chain_id(data, &pctx->ctx->chain_id);
}

static bool parse_token_id(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    if (data->value.size != INT256_LENGTH) return false;
    memmove(pctx->ctx->token_id, data->value.ptr, INT256_LENGTH);
    return true;
}

static bool parse_issued_at(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    if (data->value.size != 4) return false;
    pctx->ctx->issued_at = (uint32_t)data->value.ptr[0] << 24 |
                           (uint32_t)data->value.ptr[1] << 16 |
                           (uint32_t)data->value.ptr[2] << 8  |
                           (uint32_t)data->value.ptr[3];
    return true;
}

static bool parse_expires_at(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    if (data->value.size != 4) return false;
    pctx->ctx->expires_at = (uint32_t)data->value.ptr[0] << 24 |
                            (uint32_t)data->value.ptr[1] << 16 |
                            (uint32_t)data->value.ptr[2] << 8  |
                            (uint32_t)data->value.ptr[3];
    return true;
}

static bool parse_attester_id(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    if (data->value.size != 1) return false;
    pctx->ctx->attester_id = data->value.ptr[0];
    return true;
}

static bool parse_string_field(const tlv_data_t *data, char *buf, size_t max_len) {
    size_t copy_len = data->value.size < max_len ? data->value.size : max_len;
    memmove(buf, data->value.ptr, copy_len);
    buf[copy_len] = '\0';
    return true;
}

static bool parse_market_name(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    return parse_string_field(data, pctx->ctx->market_name, MCP_MARKET_NAME_MAX);
}

static bool parse_market_outcome(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    return parse_string_field(data, pctx->ctx->market_outcome, MCP_MARKET_OUTCOME_MAX);
}

static bool parse_market_amount(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    return parse_string_field(data, pctx->ctx->market_amount, MCP_MARKET_AMOUNT_MAX);
}

static bool parse_signature(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    if (data->value.size < CX_ECDSA_SHA256_SIG_MIN_ASN1_LENGTH ||
        data->value.size > CX_ECDSA_SHA256_SIG_MAX_ASN1_LENGTH) {
        return false;
    }
    pctx->sig = data->value.ptr;
    pctx->sig_size = data->value.size;
    return true;
}

static bool mcp_common_handler(const tlv_data_t *data, s_mcp_parse_ctx *pctx);

#define MCP_TAGS(X)                                                                      \
    X(TAG_MCP_STRUCT_TYPE,    parse_struct_type,    ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_STRUCT_VERSION, parse_struct_version, ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_CHAIN_ID,       parse_chain_id,       ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_TOKEN_ID,       parse_token_id,       ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_ISSUED_AT,      parse_issued_at,      ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_EXPIRES_AT,     parse_expires_at,     ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_ATTESTER_ID,    parse_attester_id,    ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_MARKET_NAME,    parse_market_name,    ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_MARKET_OUTCOME, parse_market_outcome, ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_MARKET_AMOUNT,  parse_market_amount,  ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_DER_SIGNATURE,  parse_signature,      ENFORCE_UNIQUE_TAG)

DEFINE_TLV_PARSER(MCP_TAGS, &mcp_common_handler, mcp_tlv_parser)

static bool mcp_common_handler(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    // Hash all tags except the signature itself
    if (data->tag != TAG_MCP_DER_SIGNATURE) {
        hash_nbytes(data->raw.ptr, data->raw.size, (cx_hash_t *) &pctx->hash_ctx);
    }
    return true;
}

static bool mcp_verify_signature(const s_mcp_parse_ctx *pctx) {
    uint8_t hash[INT256_LENGTH] = {0};
    if (!finalize_hash((cx_hash_t *) &pctx->hash_ctx, hash, sizeof(hash))) {
        PRINTF("[MCP] Failed to finalize hash\n");
        return false;
    }
    return check_signature_with_pubkey(
        hash,
        sizeof(hash),
        MCP_ATTESTER_PUBLIC_KEY,
        MCP_ATTESTER_PUBLIC_KEY_LEN,
        0,  // keyUsageExp unused in legacy path
        pctx->sig,
        pctx->sig_size
    );
}

static bool mcp_verify_mandatory_tags(const s_mcp_parse_ctx *pctx) {
    return TLV_CHECK_RECEIVED_TAGS(
        pctx->received_tags,
        TAG_MCP_STRUCT_TYPE,
        TAG_MCP_STRUCT_VERSION,
        TAG_MCP_CHAIN_ID,
        TAG_MCP_TOKEN_ID,
        TAG_MCP_ISSUED_AT,
        TAG_MCP_EXPIRES_AT,
        TAG_MCP_MARKET_NAME,
        TAG_MCP_MARKET_OUTCOME,
        TAG_MCP_MARKET_AMOUNT,
        TAG_MCP_DER_SIGNATURE
    );
}

bool mcp_parse_payload(const buffer_t *buf) {
    s_mcp_parse_ctx pctx = {0};
    pctx.ctx = &g_market_context;
    market_context_clear();
    cx_sha256_init(&pctx.hash_ctx);

    if (!mcp_tlv_parser(buf, &pctx, &pctx.received_tags)) {
        PRINTF("[MCP] TLV parse failed\n");
        return false;
    }
    if (!mcp_verify_mandatory_tags(&pctx)) {
        PRINTF("[MCP] Missing mandatory tags\n");
        return false;
    }
    g_market_context.valid = true;
    if (!mcp_verify_signature(&pctx)) {
        PRINTF("[MCP] Signature verification failed\n");
        market_context_clear();
        return false;
    }
    g_market_context.verified = true;
    PRINTF("[MCP] Valid context: %s | %s | %s\n",
           g_market_context.market_name,
           g_market_context.market_outcome,
           g_market_context.market_amount);
    return true;
}
```

Also add `mcp_parse_payload` declaration to `mcp_tlv.h`:

```c
// Add to mcp_tlv.h:
#include "tlv_library.h"
bool mcp_parse_payload(const buffer_t *buf);
```

- [ ] **Step 3: Commit state and TLV parser**

```bash
git add src/features/provide_market_context/market_context.c \
        src/features/provide_market_context/mcp_tlv.c \
        src/features/provide_market_context/mcp_tlv.h
git commit -m "feat: add MCP TLV parser and state management"
```

---

### Task 7: APDU handler and main.c dispatch

**Files:**
- Create: `device_app/src/features/provide_market_context/cmd_provide_market_context.h`
- Create: `device_app/src/features/provide_market_context/cmd_provide_market_context.c`
- Modify: `device_app/src/main.c`

- [ ] **Step 1: Create `cmd_provide_market_context.h`**

```c
// device_app/src/features/provide_market_context/cmd_provide_market_context.h
#pragma once
#include <stdint.h>

uint16_t handle_provide_market_context(uint8_t p1,
                                       uint8_t p2,
                                       const uint8_t *data,
                                       uint8_t length);
```

- [ ] **Step 2: Create `cmd_provide_market_context.c`**

```c
// device_app/src/features/provide_market_context/cmd_provide_market_context.c
#include "cmd_provide_market_context.h"
#include "mcp_tlv.h"
#include "market_context.h"
#include "apdu_constants.h"
#include "tlv_apdu.h"

uint16_t handle_provide_market_context(uint8_t p1,
                                       uint8_t p2,
                                       const uint8_t *data,
                                       uint8_t length) {
    UNUSED(p1);
    if (!tlv_from_apdu(p2 == P1_FIRST_CHUNK, length, data, &mcp_parse_payload)) {
        PRINTF("[MCP] APDU handler: tlv_from_apdu failed\n");
        return SWO_INCORRECT_DATA;
    }
    return SWO_SUCCESS;
}
```

- [ ] **Step 3: Add dispatch case to `main.c`**

In `device_app/src/main.c`, find the block:

```c
#ifdef HAVE_GATING_SUPPORT
        case INS_PROVIDE_GATING:
            sw = handle_gating(cmd->p1, cmd->p2, cmd->data, cmd->lc);
            break;
#endif

        default:
```

Add after the gating block, before `default:`:

```c
        case INS_PROVIDE_MARKET_CONTEXT:
            sw = handle_provide_market_context(cmd->p1, cmd->p2, cmd->data, cmd->lc);
            break;
```

- [ ] **Step 4: Add include to `main.c`** (at top with other feature includes)

```c
#include "features/provide_market_context/cmd_provide_market_context.h"
```

- [ ] **Step 5: Hook cleanup in `reset_app_context()`**

In `device_app/src/main.c`, inside `reset_app_context()`, after `clear_safe_account();` add:

```c
    market_context_clear();
```

Also add include at top:

```c
#include "features/provide_market_context/market_context.h"
```

- [ ] **Step 6: Commit APDU handler and dispatch**

```bash
git add src/features/provide_market_context/cmd_provide_market_context.h \
        src/features/provide_market_context/cmd_provide_market_context.c \
        src/main.c
git commit -m "feat: add INS_PROVIDE_MARKET_CONTEXT (0x3A) APDU handler and dispatch"
```

---

### Task 8: Verify APDU builds and responds

**Files:** No new files — compilation verification only.

- [ ] **Step 1: Build the app for nanosp**

```bash
cd device_app
make clean && make TARGET=nanosp 2>&1 | tail -30
```

Expected: `BUILD SUCCESSFUL` — no errors mentioning `market_context`, `mcp_tlv`, or `handle_provide_market_context`.

- [ ] **Step 2: Write a minimal ragger test for APDU receipt**

Add to `device_app/tests/ragger/test_market_context.py`:

```python
def test_mcp_apdu_accepted(backend, firmware):
    """INS_PROVIDE_MARKET_CONTEXT (0x3A) returns 0x9000 for a valid payload."""
    from ledger_app_clients.ethereum.client import EthAppClient
    from ledger_app_clients.ethereum.market_context import MarketContext

    app_client = EthAppClient(backend)
    token_id = bytes.fromhex(
        "DEADBEEFCAFEBABE1234567890ABCDEF"
        "12345678901234567890ABCDEF123456"
    )
    mcp = MarketContext(
        token_id=token_id,
        chain_id=137,
        market_name="Will Trump win the 2026 midterms?",
        market_outcome="YES",
        market_amount="50.00 USDC",
    )
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000
```

- [ ] **Step 3: Run APDU test**

```bash
pytest tests/ragger/test_market_context.py::test_mcp_apdu_accepted -v --device nanosp
```

Expected: `PASSED` — APDU is dispatched and returns 0x9000.

- [ ] **Step 4: Commit APDU test**

```bash
git add tests/ragger/test_market_context.py
git commit -m "test: verify INS_PROVIDE_MARKET_CONTEXT APDU returns 0x9000"
```

---

### Task 9: EIP-712 tokenId extraction and chain_id binding

**Files:**
- Modify: `device_app/src/features/sign_message_eip712/field_hash.c`
- Modify: `device_app/src/features/sign_message_eip712/commands_712.c`

- [ ] **Step 1: Extract tokenId in `field_hash.c`**

In `device_app/src/features/sign_message_eip712/field_hash.c`, add include:

```c
#include "features/provide_market_context/market_context.h"
```

Inside `field_hash()`, after the line `if (path_get_root_type() == ROOT_DOMAIN)` block ends (around where `field_hash_finalize` is called), add a hook for `ROOT_MESSAGE` tokenId:

```c
    // MCP: capture tokenId from message fields for binding check
    if (path_get_root_type() == ROOT_MESSAGE &&
        field_ptr->key_name != NULL &&
        strcmp(field_ptr->key_name, "tokenId") == 0 &&
        field_ptr->type == TYPE_SOL_UINT &&
        data_length <= INT256_LENGTH) {
        // Right-align tokenId into 32-byte buffer (big-endian)
        explicit_bzero(g_market_context.token_id, INT256_LENGTH);
        memmove(g_market_context.token_id + (INT256_LENGTH - data_length), data, data_length);
        PRINTF("[MCP] Captured tokenId from EIP-712 message\n");
    }
```

Place this block BEFORE the `field_hash_finalize()` call so we capture the raw value.

- [ ] **Step 2: Add binding check in `commands_712.c`**

In `device_app/src/features/sign_message_eip712/commands_712.c`, add include:

```c
#include "features/provide_market_context/market_context.h"
```

Find where `ui_712_end_sign()` is called (approximately line 309). Before that call, add:

```c
        // MCP binding: if market context was provided, verify chainId matches
        if (market_context_is_valid()) {
            if (eip712_context != NULL &&
                g_market_context.chain_id != eip712_context->chain_id) {
                PRINTF("[MCP] chain_id mismatch: MCP=%llu EIP712=%llu\n",
                       g_market_context.chain_id, eip712_context->chain_id);
                market_context_clear();
                io_send_sw(SWO_INCORRECT_DATA);
                return;
            }
        }
```

- [ ] **Step 3: Build to verify no compilation errors**

```bash
cd device_app && make TARGET=nanosp 2>&1 | grep -E "error:|warning:" | head -20
```

Expected: no new errors.

- [ ] **Step 4: Commit binding logic**

```bash
git add src/features/sign_message_eip712/field_hash.c \
        src/features/sign_message_eip712/commands_712.c
git commit -m "feat: extract EIP-712 tokenId for MCP binding, verify chain_id at sign time"
```

---

### Task 10: Inject MCP UI screens into EIP-712 review

**Files:**
- Modify: `device_app/src/features/sign_message_eip712/ui_logic.c`

- [ ] **Step 1: Add function `ui_712_inject_mcp_screens()` to `ui_logic.c`**

Add include at top:

```c
#include "features/provide_market_context/market_context.h"
```

Add the following function before `ui_712_end_sign()`:

```c
/**
 * Inject MCP market context screens into the EIP-712 UI pair list.
 * Called before ui_712_end_sign() when MCP is valid and verified.
 */
static void ui_712_inject_mcp_screens(void) {
    if (!market_context_is_valid()) return;

    // Screen: Market name
    ui_712_set_title("Market", strlen("Market"));
    ui_712_set_value(g_market_context.market_name,
                     strlen(g_market_context.market_name));

    // Screen: Outcome
    ui_712_set_title("Outcome", strlen("Outcome"));
    ui_712_set_value(g_market_context.market_outcome,
                     strlen(g_market_context.market_outcome));

    // Screen: Amount
    ui_712_set_title("Amount", strlen("Amount"));
    ui_712_set_value(g_market_context.market_amount,
                     strlen(g_market_context.market_amount));

    PRINTF("[MCP] Injected %d MCP UI screens\n", 3);
}
```

- [ ] **Step 2: Call `ui_712_inject_mcp_screens()` at start of `ui_712_end_sign()`**

Inside `ui_712_end_sign()`, at the very beginning after the `if (ui_ctx == NULL)` guard:

```c
void ui_712_end_sign(void) {
    if (ui_ctx == NULL) {
        apdu_response_code = SWO_COMMAND_NOT_ALLOWED;
        return;
    }

    // Inject MCP market context screens at the front of the review
    ui_712_inject_mcp_screens();   // ← add this line

#ifdef SCREEN_SIZE_WALLET
    // ... rest unchanged
```

- [ ] **Step 3: Build**

```bash
cd device_app && make TARGET=nanosp 2>&1 | grep -E "error:" | head -10
```

Expected: no errors.

- [ ] **Step 4: Write UI injection test**

Add to `device_app/tests/ragger/test_market_context.py`:

```python
def test_mcp_screens_appear_before_eip712(backend, firmware, navigator, test_name, default_screenshot_path):
    """MCP screens (Market, Outcome, Amount) appear before EIP-712 fields."""
    from ledger_app_clients.ethereum.client import EthAppClient
    from ledger_app_clients.ethereum.command_builder import SignMode
    from ledger_app_clients.ethereum.market_context import MarketContext

    app_client = EthAppClient(backend)
    BIP32_PATH = "m/44'/60'/0'/0/0"

    token_id = bytes.fromhex(
        "DEADBEEFCAFEBABE1234567890ABCDEF"
        "12345678901234567890ABCDEF123456"
    )
    mcp = MarketContext(
        token_id=token_id,
        chain_id=137,
        market_name="Will Trump win the 2026 midterms?",
        market_outcome="YES",
        market_amount="50.00 USDC",
    )
    # Send MCP FIRST, then sign
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000

    with app_client.sign_typed_data(
        BIP32_PATH,
        POLYMARKET_DOMAIN,
        POLYMARKET_ORDER_TYPE,
        SAMPLE_ORDER,
        mode=SignMode.NEW,
    ):
        navigator.navigate_and_compare(
            default_screenshot_path,
            test_name,
            [NavInsID.USE_CASE_REVIEW_CONFIRM],
        )
```

- [ ] **Step 5: Run UI test and capture screenshots**

```bash
pytest tests/ragger/test_market_context.py::test_mcp_screens_appear_before_eip712 \
  -v --device nanosp --golden_run
```

Expected: test passes, snapshot images generated showing "Market", "Outcome", "Amount" screens before EIP-712 fields.

- [ ] **Step 6: Commit UI injection**

```bash
git add src/features/sign_message_eip712/ui_logic.c \
        tests/ragger/test_market_context.py
git commit -m "feat: inject MCP market context screens into EIP-712 review flow"
```

---

### Task 11: Security tests

**Files:**
- Modify: `device_app/tests/ragger/test_market_context.py`

- [ ] **Step 1: Add invalid signature test**

```python
def test_mcp_invalid_signature_rejected(backend, firmware):
    """Invalid signature on MCP payload returns SWO_INCORRECT_DATA (0x6A80)."""
    from ledger_app_clients.ethereum.client import EthAppClient
    from ledger_app_clients.ethereum.market_context import MarketContext
    from ledger_app_clients.ethereum.tlv import FieldTag

    app_client = EthAppClient(backend)

    mcp = MarketContext(
        token_id=bytes(32),
        chain_id=137,
        market_name="Test Market",
        market_outcome="YES",
        market_amount="10.00 USDC",
    )
    # Corrupt the payload by flipping bytes in the signature region
    blob = bytearray(mcp.serialize())
    blob[-3] ^= 0xFF  # flip 3 bytes before end (inside DER signature)
    blob[-2] ^= 0xFF
    blob[-1] ^= 0xFF
    corrupted = bytes(blob)

    chunks = app_client._cmd_builder.provide_market_context(corrupted)
    response = None
    for chunk in chunks:
        response = backend.exchange_raw(chunk)
    assert response.status == 0x6A80, f"Expected 0x6A80 (INCORRECT_DATA), got {response.status:#06x}"
```

- [ ] **Step 2: Add chain_id mismatch test**

```python
def test_mcp_chain_id_mismatch_aborts_sign(backend, firmware, navigator):
    """MCP with wrong chain_id causes signing to abort with SWO_INCORRECT_DATA."""
    from ledger_app_clients.ethereum.client import EthAppClient
    from ledger_app_clients.ethereum.command_builder import SignMode
    from ledger_app_clients.ethereum.market_context import MarketContext

    app_client = EthAppClient(backend)
    BIP32_PATH = "m/44'/60'/0'/0/0"

    token_id = bytes(32)
    # MCP says chain_id=1 (Ethereum mainnet) but EIP-712 domain says chainId=137 (Polygon)
    mcp = MarketContext(
        token_id=token_id,
        chain_id=1,  # ← WRONG chain
        market_name="Test Market",
        market_outcome="YES",
        market_amount="10.00 USDC",
    )
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000  # MCP itself accepted OK

    # The sign should fail during binding check
    with pytest.raises(Exception):
        with app_client.sign_typed_data(
            BIP32_PATH,
            POLYMARKET_DOMAIN,  # chainId=137
            POLYMARKET_ORDER_TYPE,
            SAMPLE_ORDER,
            mode=SignMode.NEW,
        ):
            pass  # should not reach here
```

- [ ] **Step 3: Run all security tests**

```bash
pytest tests/ragger/test_market_context.py -v --device nanosp -k "invalid or mismatch" 2>&1 | tail -20
```

Expected: both tests `PASSED`.

- [ ] **Step 4: Commit security tests**

```bash
git add tests/ragger/test_market_context.py
git commit -m "test: add MCP security tests — invalid signature, chain_id mismatch"
```

---

## Phase 2: Web App Integration

### Task 12: Polymarket context loader (TypeScript)

**Files:**
- Create: `apps/web/src/lib/polymarket-context.ts`

- [ ] **Step 1: Create `polymarket-context.ts`**

```typescript
// apps/web/src/lib/polymarket-context.ts
import { parseAbiItem, decodeAbiParameters, type Hex } from "viem";

// Polymarket CLOB API endpoint
const POLYMARKET_CLOB_API = "https://clob.polymarket.com";

// CTFExchange fillOrder selector: keccak256("fillOrder((uint256,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8),uint256)")[0:4]
const FILL_ORDER_SELECTOR = "0x9b58bc26";

// EIP-712 primaryType for Polymarket orders
const POLYMARKET_PRIMARY_TYPE = "Order";

export interface PolymarketMarketInfo {
  tokenId: bigint;
  chainId: number;
  marketName: string;
  marketOutcome: string; // "YES" or "NO"
  marketAmount: string;  // e.g., "50.00 USDC"
  makerAmount: bigint;
  takerAmount: bigint;
  side: number; // 0 = BUY, 1 = SELL
}

/**
 * Returns true if the given EIP-712 typed data is a Polymarket Order.
 */
export function isPolymarketOrder(
  primaryType: string,
  domain: Record<string, unknown>,
): boolean {
  return (
    primaryType === POLYMARKET_PRIMARY_TYPE &&
    domain.chainId === 137
  );
}

/**
 * Fetch market metadata from Polymarket CLOB API for a given tokenId.
 */
async function fetchMarketMetadata(tokenId: bigint): Promise<{
  question: string;
  outcome: string;
}> {
  const tokenIdHex = tokenId.toString(16).padStart(64, "0");
  const url = `${POLYMARKET_CLOB_API}/markets?clob_token_ids=${tokenIdHex}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Polymarket API error: ${res.status}`);
  }
  const data = await res.json();
  const markets: Array<{
    question: string;
    tokens: Array<{ token_id: string; outcome: string }>;
  }> = data?.data ?? data;

  if (!markets || markets.length === 0) {
    throw new Error(`No market found for tokenId ${tokenIdHex}`);
  }
  const market = markets[0];
  const tokenHex = tokenId.toString(16).padStart(64, "0");
  const token = market.tokens.find(
    (t) => t.token_id.toLowerCase() === tokenHex.toLowerCase()
  );
  const outcome = token?.outcome ?? "UNKNOWN";
  return { question: market.question, outcome };
}

/**
 * Build PolymarketMarketInfo from EIP-712 typed data message + off-chain API.
 * Call this before signing a Polymarket order.
 */
export async function buildPolymarketContext(
  message: Record<string, unknown>,
  chainId: number,
): Promise<PolymarketMarketInfo> {
  const tokenId = BigInt(message.tokenId as string);
  const makerAmount = BigInt(message.makerAmount as string);
  const takerAmount = BigInt(message.takerAmount as string);
  const side = Number(message.side);

  const { question, outcome } = await fetchMarketMetadata(tokenId);

  // Format USDC amount (6 decimals)
  const usdcAmount = side === 0 ? makerAmount : takerAmount;
  const formattedAmount = `${(Number(usdcAmount) / 1_000_000).toFixed(2)} USDC`;

  return {
    tokenId,
    chainId,
    marketName: question.slice(0, 100), // truncate for device display
    marketOutcome: outcome,
    marketAmount: formattedAmount,
    makerAmount,
    takerAmount,
    side,
  };
}

/**
 * Serialize a PolymarketMarketInfo into a MCP TLV binary payload.
 * The payload is signed by the backend attester service.
 */
export async function fetchSignedMCPPayload(
  info: PolymarketMarketInfo,
): Promise<Uint8Array> {
  const res = await fetch("/api/market-context/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenId: info.tokenId.toString(),
      chainId: info.chainId,
      marketName: info.marketName,
      marketOutcome: info.marketOutcome,
      marketAmount: info.marketAmount,
    }),
  });
  if (!res.ok) {
    throw new Error(`MCP signing failed: ${res.status}`);
  }
  const { payload } = await res.json();
  return Uint8Array.from(Buffer.from(payload, "hex"));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web
pnpm typecheck 2>&1 | grep "polymarket-context" | head -10
```

Expected: no type errors for `polymarket-context.ts`.

- [ ] **Step 3: Commit context loader**

```bash
git add apps/web/src/lib/polymarket-context.ts
git commit -m "feat: add Polymarket CLOB API context loader"
```

---

### Task 13: Backend MCP signing endpoint

**Files:**
- Create: `apps/web/api/market-context/sign.ts` (Vercel serverless)

- [ ] **Step 1: Create signing endpoint**

```typescript
// apps/web/api/market-context/sign.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TLV tag constants (must match C device code)
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
  DER_SIGNATURE: 0x15,
};

const MCP_STRUCT_TYPE = 0x0a;
const MCP_STRUCT_VERSION = 0x01;
const TTL_SECONDS = 300;

function tlvField(tag: number, value: Buffer): Buffer {
  const tagBuf = Buffer.alloc(1);
  tagBuf.writeUInt8(tag);
  const len = value.length;
  let lenBuf: Buffer;
  if (len < 0x80) {
    lenBuf = Buffer.alloc(1);
    lenBuf.writeUInt8(len);
  } else if (len <= 0xff) {
    lenBuf = Buffer.from([0x81, len]);
  } else {
    lenBuf = Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  }
  return Buffer.concat([tagBuf, lenBuf, value]);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();

  const { tokenId, chainId, marketName, marketOutcome, marketAmount } = req.body;
  if (!tokenId || !chainId || !marketName || !marketOutcome || !marketAmount) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + TTL_SECONDS;

  // Build TLV payload (all tags except DER_SIGNATURE)
  const tokenIdBuf = Buffer.from(BigInt(tokenId).toString(16).padStart(64, "0"), "hex");
  const chainIdBuf = Buffer.alloc(8);
  chainIdBuf.writeBigUInt64BE(BigInt(chainId));
  const issuedAtBuf = Buffer.alloc(4);
  issuedAtBuf.writeUInt32BE(now);
  const expiresAtBuf = Buffer.alloc(4);
  expiresAtBuf.writeUInt32BE(expiresAt);

  let payload = Buffer.concat([
    tlvField(TAG.STRUCT_TYPE, Buffer.from([MCP_STRUCT_TYPE])),
    tlvField(TAG.STRUCT_VERSION, Buffer.from([MCP_STRUCT_VERSION])),
    tlvField(TAG.CHAIN_ID, chainIdBuf),
    tlvField(TAG.TOKEN_ID, tokenIdBuf),
    tlvField(TAG.ISSUED_AT, issuedAtBuf),
    tlvField(TAG.EXPIRES_AT, expiresAtBuf),
    tlvField(TAG.ATTESTER_ID, Buffer.from([0x00])),
    tlvField(TAG.MARKET_NAME, Buffer.from(marketName.slice(0, 128))),
    tlvField(TAG.MARKET_OUTCOME, Buffer.from(marketOutcome.slice(0, 16))),
    tlvField(TAG.MARKET_AMOUNT, Buffer.from(marketAmount.slice(0, 32))),
  ]);

  // Sign SHA-256(payload) with SECP256K1 private key (DER format)
  const privKeyPem = process.env.MCP_ATTESTER_PRIVATE_KEY_PEM;
  if (!privKeyPem) {
    return res.status(500).json({ error: "Attester key not configured" });
  }
  const hash = createHash("sha256").update(payload).digest();
  const sign = createSign("SHA256");
  sign.update(hash);
  // sign.end();  // not needed with createSign('SHA256') + .update()
  const sig = sign.sign(privKeyPem); // returns DER-encoded signature

  payload = Buffer.concat([payload, tlvField(TAG.DER_SIGNATURE, sig)]);

  return res.status(200).json({ payload: payload.toString("hex") });
}
```

- [ ] **Step 2: Add `MCP_ATTESTER_PRIVATE_KEY_PEM` env var**

In your `.env.local` (never commit private key):

```bash
# Export your PEM key as a single-line env var:
MCP_ATTESTER_PRIVATE_KEY_PEM="$(cat device_app/client/src/ledger_app_clients/ethereum/keychain/polymarket_mcp.pem | tr '\n' '|')"
```

In Vercel dashboard, set `MCP_ATTESTER_PRIVATE_KEY_PEM` as an environment variable with the PEM content (multi-line is OK in Vercel env vars).

- [ ] **Step 3: Verify endpoint compiles**

```bash
cd apps/web && pnpm typecheck 2>&1 | grep "sign.ts" | head -5
```

Expected: no errors.

- [ ] **Step 4: Commit signing endpoint**

```bash
git add apps/web/api/market-context/sign.ts
git commit -m "feat: add MCP signing endpoint /api/market-context/sign"
```

---

### Task 14: Wire MCP into ledger-provider before EIP-712 sign

**Files:**
- Modify: `apps/web/src/lib/ledger-provider.tsx`

- [ ] **Step 1: Locate the `signTypedData` function in `ledger-provider.tsx`**

Search for the function that calls `signTypedData` on `SignerEthBuilder`. It will contain something like:

```typescript
const action = new SignTypedDataDeviceAction(...)
// or
signer.signTypedData(...)
```

- [ ] **Step 2: Add MCP pre-signing injection**

Find the section that builds the typed data signing device action. Before the signing action is executed, add:

```typescript
import {
  isPolymarketOrder,
  buildPolymarketContext,
  fetchSignedMCPPayload,
} from "./polymarket-context";

// ... inside signTypedData, before executing the sign action:

// MCP: inject market context for Polymarket orders
if (
  typedData.primaryType &&
  typedData.domain &&
  isPolymarketOrder(
    typedData.primaryType as string,
    typedData.domain as Record<string, unknown>
  )
) {
  try {
    const info = await buildPolymarketContext(
      typedData.message as Record<string, unknown>,
      Number(typedData.domain.chainId),
    );
    const mcpPayload = await fetchSignedMCPPayload(info);

    // Send MCP APDU via raw DMK command
    // The payload is chunked the same way as other TLV APDUs
    const INS_PROVIDE_MARKET_CONTEXT = 0x3a;
    const CLA = 0xe0;
    const CHUNK_SIZE = 250;

    let isFirst = true;
    for (let offset = 0; offset < mcpPayload.length; offset += CHUNK_SIZE) {
      const chunk = mcpPayload.slice(offset, offset + CHUNK_SIZE);
      const p2 = isFirst ? 0x01 : 0x00; // P1_FIRST_CHUNK = 0x01, FOLLOWING = 0x00
      const apdu = new Uint8Array([CLA, INS_PROVIDE_MARKET_CONTEXT, 0x00, p2, chunk.length, ...chunk]);
      await dmk.sendApdu({ sessionId, apdu });
      isFirst = false;
    }
  } catch (err) {
    console.warn("[MCP] Failed to inject market context:", err);
    // fail-open: continue with standard EIP-712 display
  }
}
```

> **Note:** The exact API for sending a raw APDU depends on how `DeviceManagementKit` is used in `ledger-provider.tsx`. Read the existing signing code to find the `dmk` / `sessionId` variables and the APDU send method. The pattern above uses `dmk.sendApdu` — adjust to match actual usage.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/web && pnpm typecheck 2>&1 | grep -E "error" | head -10
```

Expected: no new type errors.

- [ ] **Step 4: Commit web integration**

```bash
git add apps/web/src/lib/ledger-provider.tsx
git commit -m "feat: inject MCP APDU before Polymarket EIP-712 signing in ledger-provider"
```

---

## Self-Review

### Spec Coverage Check

| Spec Section | Covered By |
|---|---|
| Baseline freeze (Step 1) | Task 1 |
| TLV format definition (Step 2) | Tasks 3, 5 |
| New APDU INS 0x3A (Step 3) | Tasks 5, 7 |
| MCP state + lifecycle (Step 4) | Tasks 5, 6 |
| Signature verification (Step 5) | Task 6 (mcp_tlv.c verify_signature) |
| EIP-712 binding (Step 6) | Task 9 |
| UI injection (Step 7) | Task 10 |
| Python client (Step 8) | Tasks 3, 4 |
| Ragger tests (Step 9) | Tasks 1, 8, 10, 11 |
| Web/backend integration (Step 11) | Tasks 12, 13, 14 |
| Fail-close policy | Task 9 (chain_id mismatch aborts), Task 11 (invalid sig rejected) |

### Notes

- **Task 14 Note:** The exact `sendApdu` API in `ledger-provider.tsx` needs to be confirmed by reading the DMK usage in that file. The plan shows the intent; adapt to actual API.
- **Task 5 Note:** The public key bytes in `market_context_keys.h` must be filled in from the actual output of Task 2 keygen step — they cannot be predicted in advance.
- **Fuzzing (Spec Step 10)** is excluded from this plan as a post-MVP enhancement.
- **Telemetry / feature flags (Spec Step 12)** excluded — add post-demo.
