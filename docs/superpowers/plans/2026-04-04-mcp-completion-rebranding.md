# MCP Completion + Polymarket Rebranding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all remaining MCP (Market Context Protocol) implementation steps, rebrand the app from "Ethereum" to "Polymarket", and add missing tests + fuzzing harness.

**Architecture:** The device app already has MCP TLV parsing, APDU handler, UI injection, and Python client. We complete: TTL sanity checks in the TLV parser, tokenId binding between MCP and EIP-712 message fields via a new extraction hook in field_hash.c, additional Ragger tests, a fuzzing harness, and icon/name rebranding.

**Tech Stack:** C (Ledger BOLOS SDK), Python (Ragger test framework, Pillow for icon generation), libFuzzer

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `makefile_conf/chain/ethereum.mk` | App name → "Polymarket" |
| Replace | `icons/nanox_app_chain_1.gif` (14x14) | Polymarket app icon for Nano X/S+ |
| Replace | `icons/stax_app_chain_1.gif` (32x32) | Polymarket app icon for Stax |
| Replace | `icons/flex_app_chain_1.gif` (40x40) | Polymarket app icon for Flex |
| Replace | `icons/apex_app_chain_1.gif` (32x32) | Polymarket app icon for Apex |
| Replace | `glyphs/chain_1_14px.gif` (14x14) | Polymarket glyph 14px |
| Replace | `glyphs/chain_1_48px.gif` (48x48) | Polymarket glyph 48px |
| Replace | `glyphs/chain_1_64px.gif` (64x64) | Polymarket glyph 64px |
| Replace | `glyphs/home_chain_1_14px.gif` (14x14) | Polymarket home glyph |
| Modify | `src/features/provide_market_context/mcp_tlv.c` | Add TTL sanity check |
| Modify | `src/features/provide_market_context/market_context.h` | Add extracted EIP-712 tokenId storage |
| Modify | `src/features/provide_market_context/market_context.c` | Clear extracted tokenId |
| Modify | `src/features/sign_message_eip712/field_hash.c` | Extract tokenId from EIP-712 message fields |
| Modify | `src/features/sign_message_eip712/commands_712.c` | Add tokenId binding check |
| Modify | `tests/ragger/test_market_context.py` | Add 3 new test cases |
| Create | `tests/fuzzing/src/fuzz_market_context.c` | Fuzzing harness for MCP parser |

---

### Task 1: Rebrand App Name

**Files:**
- Modify: `device_app/makefile_conf/chain/ethereum.mk:9`

- [ ] **Step 1: Change APPNAME**

In `makefile_conf/chain/ethereum.mk`, change line 9:

```makefile
APPNAME = "Polymarket"
```

- [ ] **Step 2: Verify build config**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && grep APPNAME makefile_conf/chain/ethereum.mk`
Expected: `APPNAME = "Polymarket"`

- [ ] **Step 3: Commit**

```bash
cd /Users/gregz./dev/ethglobal2026/device_app
git add makefile_conf/chain/ethereum.mk
git commit -m "rebrand: rename app from Ethereum to Polymarket"
```

---

### Task 2: Generate Polymarket Logo Icons

**Files:**
- Replace: `device_app/icons/nanox_app_chain_1.gif` (14x14)
- Replace: `device_app/icons/stax_app_chain_1.gif` (32x32)
- Replace: `device_app/icons/flex_app_chain_1.gif` (40x40)
- Replace: `device_app/icons/apex_app_chain_1.gif` (32x32)
- Replace: `device_app/glyphs/chain_1_14px.gif` (14x14)
- Replace: `device_app/glyphs/chain_1_48px.gif` (48x48)
- Replace: `device_app/glyphs/chain_1_64px.gif` (64x64)
- Replace: `device_app/glyphs/home_chain_1_14px.gif` (14x14)

- [ ] **Step 1: Create icon generation script**

Create a Python script `device_app/tools/gen_polymarket_icons.py` that generates all required GIF icons. The Polymarket logo is a stylized "P" shape — for small sizes we render a recognizable "P" glyph in white on transparent/black background (matching Ledger GIF conventions: indexed color, 1-bit for nano, 4-bit grayscale for larger devices).

```python
#!/usr/bin/env python3
"""Generate Polymarket logo GIF icons for all Ledger device targets."""

from PIL import Image, ImageDraw, ImageFont
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SCRIPT_DIR)

# Polymarket brand color (not used for 1-bit icons, but for reference)
POLY_GREEN = (0, 200, 83)

def draw_p_glyph(size: int) -> Image.Image:
    """Draw a stylized 'P' (Polymarket logo) at given pixel size.

    Ledger icons are white-on-black (or white-on-transparent).
    For nano (14px): 1-bit black & white
    For stax/flex/apex (32-64px): grayscale with antialiasing
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if size <= 14:
        # Pixel art P for tiny icons — manually placed pixels
        # Scale factor
        s = size / 14.0
        # Draw a blocky P shape
        draw.rectangle([int(3*s), int(2*s), int(5*s), int(11*s)], fill="white")  # vertical bar
        draw.rectangle([int(5*s), int(2*s), int(10*s), int(4*s)], fill="white")  # top horizontal
        draw.rectangle([int(5*s), int(5*s), int(10*s), int(7*s)], fill="white")  # middle horizontal
        draw.rectangle([int(9*s), int(3*s), int(11*s), int(6*s)], fill="white")  # right vertical of P bowl
    else:
        # Vector-style P for larger icons
        margin = max(2, size // 8)
        bar_w = max(3, size // 6)
        # Vertical bar of P
        draw.rectangle([margin, margin, margin + bar_w, size - margin], fill="white")
        # Top arc of P (simplified as rectangles + ellipse)
        bowl_top = margin
        bowl_bottom = size // 2 + bar_w // 2
        bowl_left = margin + bar_w
        bowl_right = size - margin
        # Top horizontal
        draw.rectangle([bowl_left, bowl_top, bowl_right - bar_w, bowl_top + bar_w], fill="white")
        # Bottom horizontal of bowl
        draw.rectangle([bowl_left, bowl_bottom - bar_w, bowl_right - bar_w, bowl_bottom], fill="white")
        # Right vertical of bowl
        draw.rectangle([bowl_right - bar_w, bowl_top, bowl_right, bowl_bottom], fill="white")
        # Round the corners with ellipse overlay
        r = bar_w
        draw.ellipse([bowl_right - 2*r, bowl_top, bowl_right, bowl_top + 2*r], fill="white")
        draw.ellipse([bowl_right - 2*r, bowl_bottom - 2*r, bowl_right, bowl_bottom], fill="white")

    return img


def save_gif(img: Image.Image, path: str, is_nano: bool = False):
    """Save image as GIF with appropriate color mode for Ledger."""
    if is_nano:
        # 1-bit for nano devices
        bw = img.convert("L").point(lambda x: 255 if x > 128 else 0, mode="1")
        bw.save(path, format="GIF", transparency=0)
    else:
        # Grayscale with transparency for larger devices
        gray = img.convert("RGBA")
        # Convert to palette mode
        p = gray.convert("P", palette=Image.ADAPTIVE, colors=16)
        p.save(path, format="GIF", transparency=0)
    print(f"  Generated: {path} ({img.size[0]}x{img.size[1]})")


def main():
    targets = [
        # (output_path, size, is_nano)
        ("icons/nanox_app_chain_1.gif", 14, True),
        ("icons/stax_app_chain_1.gif", 32, False),
        ("icons/flex_app_chain_1.gif", 40, False),
        ("icons/apex_app_chain_1.gif", 32, False),
        ("glyphs/chain_1_14px.gif", 14, True),
        ("glyphs/chain_1_48px.gif", 48, False),
        ("glyphs/chain_1_64px.gif", 64, False),
        ("glyphs/home_chain_1_14px.gif", 14, True),
    ]

    print("Generating Polymarket icons...")
    for rel_path, size, is_nano in targets:
        full_path = os.path.join(ROOT, rel_path)
        img = draw_p_glyph(size)
        save_gif(img, full_path, is_nano)

    print("Done!")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the icon generator**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python3 tools/gen_polymarket_icons.py`
Expected: 8 lines of "Generated: ..." output, one per icon file.

- [ ] **Step 3: Verify icons were generated**

Run: `file icons/*chain_1*.gif glyphs/*chain_1*.gif`
Expected: All 8 files are GIF image data with correct dimensions (14x14, 32x32, 40x40, 48x48, 64x64).

- [ ] **Step 4: Commit**

```bash
cd /Users/gregz./dev/ethglobal2026/device_app
git add icons/nanox_app_chain_1.gif icons/stax_app_chain_1.gif icons/flex_app_chain_1.gif icons/apex_app_chain_1.gif
git add glyphs/chain_1_14px.gif glyphs/chain_1_48px.gif glyphs/chain_1_64px.gif glyphs/home_chain_1_14px.gif
git add tools/gen_polymarket_icons.py
git commit -m "rebrand: replace Ethereum icons with Polymarket logo"
```

---

### Task 3: Add TTL Sanity Check (Step 5 completion)

**Files:**
- Modify: `device_app/src/features/provide_market_context/mcp_tlv.c:153-178`
- Test: `device_app/tests/ragger/test_market_context.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/ragger/test_market_context.py`:

```python
def test_mcp_expired_payload_rejected(backend):
    """MCP with expires_at <= issued_at is rejected as invalid (0x6A80)."""
    from client.market_context import MarketContext
    import time

    app_client = EthAppClient(backend)
    mcp = MarketContext(
        token_id=SAMPLE_TOKEN_ID,
        chain_id=137,
        market_name="Test Market",
        market_outcome="YES",
        market_amount="10.00 USDC",
        ttl_seconds=-10,  # expires_at will be BEFORE issued_at
    )

    from ragger.error import ExceptionRAPDU
    with pytest.raises(ExceptionRAPDU) as exc_info:
        app_client.provide_market_context(mcp)
    assert exc_info.value.status == 0x6A80
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python -m pytest tests/ragger/test_market_context.py::test_mcp_expired_payload_rejected -v --device flex`
Expected: FAIL — the device currently accepts the payload because there's no TTL check.

- [ ] **Step 3: Add TTL sanity check in mcp_parse_payload**

In `src/features/provide_market_context/mcp_tlv.c`, add the TTL check after signature verification succeeds (after line 173 `g_market_context.verified = true;`):

Replace the end of `mcp_parse_payload()` (lines 153-179) with:

```c
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
    // TTL sanity: expires_at must be strictly after issued_at
    if (g_market_context.expires_at <= g_market_context.issued_at) {
        PRINTF("[MCP] TTL sanity failed: expires_at(%u) <= issued_at(%u)\n",
               g_market_context.expires_at,
               g_market_context.issued_at);
        market_context_clear();
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python -m pytest tests/ragger/test_market_context.py::test_mcp_expired_payload_rejected -v --device flex`
Expected: PASS

- [ ] **Step 5: Run all existing MCP tests to check no regression**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python -m pytest tests/ragger/test_market_context.py -v --device flex`
Expected: All tests PASS (existing tests use `ttl_seconds=300` which is valid).

- [ ] **Step 6: Commit**

```bash
cd /Users/gregz./dev/ethglobal2026/device_app
git add src/features/provide_market_context/mcp_tlv.c tests/ragger/test_market_context.py
git commit -m "feat(mcp): add TTL sanity check — reject expired payloads"
```

---

### Task 4: Add tokenId Extraction from EIP-712 Message (Step 6 part 1)

**Files:**
- Modify: `device_app/src/features/provide_market_context/market_context.h`
- Modify: `device_app/src/features/provide_market_context/market_context.c`
- Modify: `device_app/src/features/sign_message_eip712/field_hash.c`

- [ ] **Step 1: Add storage for extracted EIP-712 tokenId**

In `market_context.h`, add after the `market_context_is_valid()` declaration:

```c
// Storage for tokenId extracted from EIP-712 message during parsing.
// Used to bind MCP context to the actual signed message.
extern uint8_t g_eip712_extracted_token_id[INT256_LENGTH];
extern bool g_eip712_token_id_extracted;

void market_context_clear_eip712_binding(void);
```

- [ ] **Step 2: Implement the storage and clear function**

In `market_context.c`, add:

```c
uint8_t g_eip712_extracted_token_id[INT256_LENGTH] = {0};
bool g_eip712_token_id_extracted = false;

void market_context_clear_eip712_binding(void) {
    explicit_bzero(g_eip712_extracted_token_id, sizeof(g_eip712_extracted_token_id));
    g_eip712_token_id_extracted = false;
}
```

Also add `market_context_clear_eip712_binding()` call inside `market_context_clear()`:

```c
void market_context_clear(void) {
    explicit_bzero(&g_market_context, sizeof(g_market_context));
    market_context_clear_eip712_binding();
}
```

- [ ] **Step 3: Hook tokenId extraction into field_hash.c**

In `src/features/sign_message_eip712/field_hash.c`, add the include at the top (after existing includes):

```c
#include "market_context.h"  // g_eip712_extracted_token_id
```

Add a new static function before `field_hash_finalize()`:

```c
/**
 * Extract special fields from message for MCP binding.
 * Currently captures tokenId (uint256) for Polymarket Order validation.
 */
static void field_hash_message_mcp_fields(const s_struct_712_field *field_ptr,
                                          const uint8_t *data,
                                          uint8_t data_length) {
    if (field_ptr->key_name == NULL) return;
    if (strcmp(field_ptr->key_name, "tokenId") != 0) return;
    if (field_ptr->type != TYPE_SOL_UINT) return;
    if (data_length > INT256_LENGTH) return;

    // Zero-pad and right-align (big-endian uint256)
    explicit_bzero(g_eip712_extracted_token_id, INT256_LENGTH);
    memcpy(&g_eip712_extracted_token_id[INT256_LENGTH - data_length], data, data_length);
    g_eip712_token_id_extracted = true;
}
```

In `field_hash_finalize()`, add the message extraction call after the domain special fields block (after line 231, before `path_advance`):

```c
    if (path_get_root_type() == ROOT_DOMAIN) {
        if (field_hash_domain_special_fields(field_ptr, data, data_length) == false) {
            return false;
        }
    } else if (path_get_root_type() == ROOT_MESSAGE) {
        field_hash_message_mcp_fields(field_ptr, data, data_length);
    }
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && make CHAIN=ethereum BOLOS_SDK=$LEDGER_SDK_PATH` (or whatever build command is available)
Expected: No compilation errors. If SDK not available locally, verify with `grep -n "field_hash_message_mcp_fields\|g_eip712_extracted_token_id" src/features/sign_message_eip712/field_hash.c src/features/provide_market_context/market_context.c src/features/provide_market_context/market_context.h` that all references are consistent.

- [ ] **Step 5: Commit**

```bash
cd /Users/gregz./dev/ethglobal2026/device_app
git add src/features/provide_market_context/market_context.h
git add src/features/provide_market_context/market_context.c
git add src/features/sign_message_eip712/field_hash.c
git commit -m "feat(mcp): extract tokenId from EIP-712 message for binding"
```

---

### Task 5: Add tokenId Binding Check at Sign Time (Step 6 part 2)

**Files:**
- Modify: `device_app/src/features/sign_message_eip712/commands_712.c:310-321`
- Test: `device_app/tests/ragger/test_market_context.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/ragger/test_market_context.py`:

```python
# The tokenId from polymarket-order-data.json as bytes (uint256 big-endian)
POLYMARKET_ORDER_TOKEN_ID = bytes.fromhex(
    "df2d9709d71cc5fe53bbf419d265903c917d961a93cfebeffc015d31e68666f8"
)


def test_mcp_token_id_mismatch_aborts_sign(backend, scenario_navigator: NavigateWithScenario):
    """MCP with wrong tokenId causes signing to abort with SWO_INCORRECT_DATA."""
    from client.market_context import MarketContext

    app_client = EthAppClient(backend)
    data = _polymarket_order_data()

    # MCP token_id does NOT match the tokenId in the EIP-712 Order
    wrong_token_id = bytes(32)  # all zeros — doesn't match order's tokenId
    mcp = MarketContext(
        token_id=wrong_token_id,
        chain_id=137,
        market_name="Test Market",
        market_outcome="YES",
        market_amount="10.00 USDC",
    )
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000  # MCP itself accepted

    settings_toggle(backend.device,
                    scenario_navigator.navigator,
                    [SettingID.BLIND_SIGNING])

    with pytest.raises(Exception):
        InputData.process_data(app_client, data)
        with app_client.eip712_sign_new(BIP32_PATH):
            scenario_navigator.review_approve_with_warning(do_comparison=False)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python -m pytest tests/ragger/test_market_context.py::test_mcp_token_id_mismatch_aborts_sign -v --device flex`
Expected: FAIL — currently the code only checks chain_id, not tokenId.

- [ ] **Step 3: Add tokenId binding check in handle_eip712_sign**

In `src/features/sign_message_eip712/commands_712.c`, add the include (if not already present):

```c
#include "market_context.h"
```

Expand the MCP binding block (lines 310-321) to also check tokenId. Replace:

```c
        // MCP binding: if market context was provided, verify chainId matches
        if (market_context_is_valid()) {
            if (eip712_context != NULL &&
                g_market_context.chain_id != eip712_context->chain_id) {
                PRINTF("[MCP] chain_id mismatch: MCP=%llu EIP712=%llu\n",
                       (unsigned long long) g_market_context.chain_id,
                       (unsigned long long) eip712_context->chain_id);
                market_context_clear();
                apdu_response_code = SWO_INCORRECT_DATA;
                ret = false;
            }
        }
```

With:

```c
        // MCP binding: if market context was provided, verify chainId and tokenId match
        if (market_context_is_valid()) {
            if (eip712_context != NULL &&
                g_market_context.chain_id != eip712_context->chain_id) {
                PRINTF("[MCP] chain_id mismatch: MCP=%llu EIP712=%llu\n",
                       (unsigned long long) g_market_context.chain_id,
                       (unsigned long long) eip712_context->chain_id);
                market_context_clear();
                apdu_response_code = SWO_INCORRECT_DATA;
                ret = false;
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

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python -m pytest tests/ragger/test_market_context.py::test_mcp_token_id_mismatch_aborts_sign -v --device flex`
Expected: PASS

- [ ] **Step 5: Verify MCP screens test still passes with matching tokenId**

The existing `test_mcp_screens_appear_before_eip712` test uses `SAMPLE_TOKEN_ID` which does NOT match the order's tokenId. Update it to use the correct tokenId from the order.

In `tests/ragger/test_market_context.py`, update `test_mcp_screens_appear_before_eip712` to use `POLYMARKET_ORDER_TOKEN_ID`:

```python
def test_mcp_screens_appear_before_eip712(scenario_navigator: NavigateWithScenario):
    """MCP screens (Market, Outcome, Amount) appear before EIP-712 fields."""
    from client.market_context import MarketContext

    app_client = EthAppClient(scenario_navigator.backend)
    data = _polymarket_order_data()

    mcp = MarketContext(
        token_id=POLYMARKET_ORDER_TOKEN_ID,  # Must match the order's tokenId
        chain_id=137,
        market_name="Will Trump win the 2026 midterms?",
        market_outcome="YES",
        market_amount="50.00 USDC",
    )
    # Send MCP FIRST, then sign
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000

    settings_toggle(scenario_navigator.backend.device,
                    scenario_navigator.navigator,
                    [SettingID.BLIND_SIGNING])

    InputData.process_data(app_client, data)
    with app_client.eip712_sign_new(BIP32_PATH):
        scenario_navigator.review_approve_with_warning(do_comparison=False)

    vrs = ResponseParser.signature(app_client.response().data)
    assert DEVICE_ADDR == recover_message(data, vrs)
```

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python -m pytest tests/ragger/test_market_context.py -v --device flex`
Expected: All tests PASS.

- [ ] **Step 7: Commit**

```bash
cd /Users/gregz./dev/ethglobal2026/device_app
git add src/features/sign_message_eip712/commands_712.c tests/ragger/test_market_context.py
git commit -m "feat(mcp): add tokenId binding check between MCP and EIP-712 message"
```

---

### Task 6: Add Multi-Chunk Payload Test (Step 9 completion)

**Files:**
- Modify: `device_app/tests/ragger/test_market_context.py`

- [ ] **Step 1: Write the chunking test**

Add to `tests/ragger/test_market_context.py`:

```python
def test_mcp_large_payload_chunking(backend):
    """MCP payload with long market name forces multi-chunk APDU and succeeds."""
    from client.market_context import MarketContext

    app_client = EthAppClient(backend)
    # 120-char market name will push total payload well over 255 bytes (single APDU limit)
    long_name = "Will the United States Federal Reserve raise interest rates above 6 percent before the end of the fiscal year 2026-2027?"
    mcp = MarketContext(
        token_id=SAMPLE_TOKEN_ID,
        chain_id=137,
        market_name=long_name,
        market_outcome="YES",
        market_amount="1000.00 USDC",
    )
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000
```

- [ ] **Step 2: Run test**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python -m pytest tests/ragger/test_market_context.py::test_mcp_large_payload_chunking -v --device flex`
Expected: PASS (the chunking logic in command_builder.py already handles this).

- [ ] **Step 3: Commit**

```bash
cd /Users/gregz./dev/ethglobal2026/device_app
git add tests/ragger/test_market_context.py
git commit -m "test(mcp): add multi-chunk APDU payload test"
```

---

### Task 7: Add Fuzzing Harness (Step 10)

**Files:**
- Create: `device_app/tests/fuzzing/src/fuzz_market_context.c`

- [ ] **Step 1: Create the fuzzing harness**

Create `tests/fuzzing/src/fuzz_market_context.c`:

```c
/**
 * Fuzzing harness for the MCP (Market Context Protocol) TLV parser.
 * Feeds arbitrary bytes into mcp_parse_payload() to detect crashes,
 * buffer overflows, or undefined behavior.
 */

#include "fuzz_utils.h"
#include "mcp_tlv.h"
#include "market_context.h"

static int fuzz_mcp(const uint8_t *data, size_t size) {
    buffer_t buf = {0};

    // mcp_parse_payload expects a buffer_t
    buf.ptr = data;
    buf.size = size;
    buf.offset = 0;

    // Call the parser — it should handle any input gracefully
    mcp_parse_payload(&buf);

    // Clean up global state for next iteration
    market_context_clear();

    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    // Reject unreasonably large inputs (MCP max payload is 1024)
    if (size > 2048) {
        return 0;
    }

    init_fuzzing_environment();
    fuzz_mcp(data, size);
    return 0;
}
```

- [ ] **Step 2: Verify file structure matches existing patterns**

Run: `ls /Users/gregz./dev/ethglobal2026/device_app/tests/fuzzing/src/`
Expected: `fuzz_market_context.c` alongside existing harness files like `fuzz_eip712.c`, `fuzz_plugin_eip7002.c`, etc.

- [ ] **Step 3: Commit**

```bash
cd /Users/gregz./dev/ethglobal2026/device_app
git add tests/fuzzing/src/fuzz_market_context.c
git commit -m "test(mcp): add fuzzing harness for MCP TLV parser"
```

---

### Task 8: Final Integration Verification

- [ ] **Step 1: Run the complete MCP test suite**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python -m pytest tests/ragger/test_market_context.py -v --device flex`
Expected: All 8 tests PASS:
1. `test_polymarket_eip712_baseline` — baseline non-regression
2. `test_mcp_apdu_accepted` — valid MCP accepted
3. `test_mcp_invalid_signature_rejected` — bad sig rejected
4. `test_mcp_chain_id_mismatch_aborts_sign` — chain_id binding
5. `test_mcp_screens_appear_before_eip712` — UI injection with matching tokenId
6. `test_mcp_expired_payload_rejected` — TTL sanity check
7. `test_mcp_token_id_mismatch_aborts_sign` — tokenId binding
8. `test_mcp_large_payload_chunking` — multi-chunk APDU

- [ ] **Step 2: Verify no regressions on other tests**

Run: `cd /Users/gregz./dev/ethglobal2026/device_app && python -m pytest tests/ragger/ -v --device flex -k "not slow"` (or whatever subset is reasonable)
Expected: No regressions.

- [ ] **Step 3: Verify branding**

Run: `grep APPNAME /Users/gregz./dev/ethglobal2026/device_app/makefile_conf/chain/ethereum.mk`
Expected: `APPNAME = "Polymarket"`

Run: `file /Users/gregz./dev/ethglobal2026/device_app/icons/*chain_1*.gif /Users/gregz./dev/ethglobal2026/device_app/glyphs/*chain_1*.gif`
Expected: All 8 GIF files exist with correct dimensions.

- [ ] **Step 4: Final commit (if any remaining changes)**

```bash
cd /Users/gregz./dev/ethglobal2026/device_app
git status
# If clean, nothing to commit. Otherwise:
git add -A && git commit -m "chore: final MCP completion + Polymarket rebranding"
```
