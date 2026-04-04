# Polyledger Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand the Ledger device app from Ethereum to Polyledger — replacing all user-visible strings, redesigning the EIP-712 signing flow to be MCP-first, and hiding Ethereum-only UI features.

**Architecture:** Surgical rebrand of the existing forked Ethereum app. Only user-visible strings and NBGL screen logic change. Protocol constants, internal macros, and file structure stay untouched. Target device: Flex only.

**Tech Stack:** C (Ledger BOLOS SDK, NBGL), Python (Ragger test framework)

**Spec:** `docs/superpowers/specs/2026-04-04-polyledger-rebrand-design.md`

---

**Note:** Icon files (`icons/flex_app_chain_1.gif`, `glyphs/chain_1_64px.gif`) are already Polymarket logos from previous commits (d5afdaa, 38d8953). No icon swap needed.

## File Map

| File | Change Type | Purpose |
|------|-------------|---------|
| `device_app/src/network.c` | Modify line 13 | Chain ID 1 name: "Ethereum" → "Polyledger" |
| `device_app/makefile_conf/chain/ethereum.mk` | Modify line 3 | Ticker: "ETH" → "USDC" |
| `device_app/src/nbgl/ui_home.c` | Modify lines 46, 258-261 | About info + standalone tagline |
| `device_app/src/nbgl/ui_tx_simulation.c` | Modify line 158 | Remove "Ethereum" from description |
| `device_app/src/nbgl/ui_gcs.c` | Modify lines 187-203 | Hide Etherscan QR block |
| `device_app/src/nbgl/ui_sign_712.c` | Modify lines 23-65 | MCP-aware review/finish titles + icon |
| `device_app/src/features/sign_message_eip712/ui_logic.c` | Modify lines 1057-1077 | MCP screen reorder |

---

### Task 1: Rebrand network name and ticker

**Files:**
- Modify: `device_app/src/network.c:13`
- Modify: `device_app/makefile_conf/chain/ethereum.mk:3`

- [ ] **Step 1: Change chain ID 1 name in network.c**

In `device_app/src/network.c`, change line 13 from:
```c
    {.chain_id = 1, .name = "Ethereum", .ticker = "ETH"},
```
to:
```c
    {.chain_id = 1, .name = "Polyledger", .ticker = "ETH"},
```

Note: Keep ticker as `"ETH"` here — this is the gas token ticker used for fee display on chain ID 1, and ETH is correct. The `TICKER` in the makefile is a separate build-level setting.

- [ ] **Step 2: Change TICKER in ethereum.mk**

In `device_app/makefile_conf/chain/ethereum.mk`, change line 3 from:
```
TICKER = "ETH"
```
to:
```
TICKER = "USDC"
```

- [ ] **Step 3: Verify build compiles**

Run:
```bash
cd device_app && make clean && make BOLOS_SDK=$LEDGER_SDK DEBUG=1 2>&1 | tail -20
```
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
cd device_app
git add src/network.c makefile_conf/chain/ethereum.mk
git commit -m "rebrand: change app name to Polyledger and ticker to USDC"
```

---

### Task 2: Rebrand home screen — about info and tagline

**Files:**
- Modify: `device_app/src/nbgl/ui_home.c:46, 258-261`

- [ ] **Step 1: Change about info strings**

In `device_app/src/nbgl/ui_home.c`, change line 46 from:
```c
static const char *const infoContents[SETTING_INFO_NB] = {APPVERSION, "Ledger", "Ledger (c) 2025"};
```
to:
```c
static const char *const infoContents[SETTING_INFO_NB] = {APPVERSION, "PoCInnovation", "PoCInnovation (c) 2025"};
```

- [ ] **Step 2: Add standalone tagline**

In `device_app/src/nbgl/ui_home.c`, change the `else` branch in `get_appname_and_tagline()` (lines 258-261) from:
```c
    } else {  // Ethereum app
        mainnet_chain_id = ETHEREUM_MAINNET_CHAINID;
        *appname = get_network_name_from_chain_id(&mainnet_chain_id);
    }
```
to:
```c
    } else {  // Polyledger standalone
        mainnet_chain_id = ETHEREUM_MAINNET_CHAINID;
        *appname = get_network_name_from_chain_id(&mainnet_chain_id);
        *tagline = "This app enables clear\nsigning transactions for\nthe Polymarket dApp.";
    }
```

- [ ] **Step 3: Verify build compiles**

Run:
```bash
cd device_app && make clean && make BOLOS_SDK=$LEDGER_SDK DEBUG=1 2>&1 | tail -20
```
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
cd device_app
git add src/nbgl/ui_home.c
git commit -m "rebrand: update about info and add Polymarket tagline"
```

---

### Task 3: Remove "Ethereum" from transaction simulation text

**Files:**
- Modify: `device_app/src/nbgl/ui_tx_simulation.c:157-159`

- [ ] **Step 1: Change description string**

In `device_app/src/nbgl/ui_tx_simulation.c`, change lines 157-159 from:
```c
    info.description =
        "Get real-time warnings about risky Ethereum transactions. "
        "Powered by service providers.";
```
to:
```c
    info.description =
        "Get real-time warnings about risky transactions. "
        "Powered by service providers.";
```

- [ ] **Step 2: Commit**

```bash
cd device_app
git add src/nbgl/ui_tx_simulation.c
git commit -m "rebrand: remove Ethereum from tx simulation description"
```

---

### Task 4: Hide Etherscan QR code block

**Files:**
- Modify: `device_app/src/nbgl/ui_gcs.c:187-204`

- [ ] **Step 1: Wrap Etherscan block with #if 0**

In `device_app/src/nbgl/ui_gcs.c`, change the Etherscan block (lines 187-204) from:
```c
        // Etherscan only for mainnet
        if (get_tx_chain_id() == ETHEREUM_MAINNET_CHAINID) {
            if ((extensions[contract_idx].explanation =
                     APP_MEM_STRDUP("Scan to view on Etherscan")) == NULL) {
                return false;
            }
            snprintf(tmp_buf,
                     tmp_buf_size,
                     "https://etherscan.io/address/%s",
                     extensions[contract_idx].title);
        } else {
            snprintf(tmp_buf, tmp_buf_size, "%s", extensions[contract_idx].title);
        }
        if ((extensions[contract_idx].fullValue = APP_MEM_STRDUP(tmp_buf)) == NULL) {
            return false;
        }
        extensions[contract_idx].aliasType = QR_CODE_ALIAS;
```
to:
```c
#if 0  // Etherscan QR disabled for Polyledger rebrand
        // Etherscan only for mainnet
        if (get_tx_chain_id() == ETHEREUM_MAINNET_CHAINID) {
            if ((extensions[contract_idx].explanation =
                     APP_MEM_STRDUP("Scan to view on Etherscan")) == NULL) {
                return false;
            }
            snprintf(tmp_buf,
                     tmp_buf_size,
                     "https://etherscan.io/address/%s",
                     extensions[contract_idx].title);
        } else {
            snprintf(tmp_buf, tmp_buf_size, "%s", extensions[contract_idx].title);
        }
        if ((extensions[contract_idx].fullValue = APP_MEM_STRDUP(tmp_buf)) == NULL) {
            return false;
        }
        extensions[contract_idx].aliasType = QR_CODE_ALIAS;
#endif
```

- [ ] **Step 2: Verify build compiles**

Run:
```bash
cd device_app && make clean && make BOLOS_SDK=$LEDGER_SDK DEBUG=1 2>&1 | tail -20
```
Expected: Build succeeds. There may be unused variable warnings for `tmp_buf` depending on surrounding code — check and suppress if needed.

- [ ] **Step 3: Commit**

```bash
cd device_app
git add src/nbgl/ui_gcs.c
git commit -m "rebrand: hide Etherscan QR code block"
```

---

### Task 5: Redesign EIP-712 review titles and icon for MCP

**Files:**
- Modify: `device_app/src/nbgl/ui_sign_712.c:20-65`

- [ ] **Step 1: Add MCP-aware titles and icon**

In `device_app/src/nbgl/ui_sign_712.c`, replace the `ui_712_start_review` function (lines 20-66) with:
```c
static void ui_712_start_review(e_eip712_filtering_mode filtering_mode,
                                nbgl_operationType_t operationType,
                                nbgl_choiceCallback_t choiceCallback) {
    bool mcp_active = market_context_is_valid();

#ifdef SCREEN_SIZE_WALLET
    const char *tx_check_str = ui_tx_simulation_finish_str();
    const char *title_suffix = mcp_active ? " order?" : " typed message?";
#else
    UNUSED(filtering_mode);
    const char *tx_check_str = "Sign";
    const char *title_suffix = mcp_active ? " order" : " message";
#endif
    uint8_t finish_len = 1;  // Initialize lengths to 1 for '\0' character

    // Initialize the finish title string
    finish_len += strlen(tx_check_str);
    finish_len += strlen(title_suffix);
    if (!ui_buffers_init(0, 0, finish_len)) {
        return;
    }
    snprintf(g_finishMsg, finish_len, "%s%s", tx_check_str, title_suffix);
#ifdef HAVE_TRANSACTION_CHECKS
    set_tx_simulation_warning();
#endif

    // Use review with skip button in case of raw message
#ifdef SCREEN_SIZE_WALLET
    if (filtering_mode == EIP712_FILTERING_BASIC) {
        operationType |= SKIPPABLE_OPERATION;
    } else
#endif
    {
        if (N_storage.verbose_eip712 || mcp_active) {
            // In verbose mode or with MCP context, we allow skipping
            operationType |= SKIPPABLE_OPERATION;
        }
    }

    const char *review_title = mcp_active ? "Review order" : "Review typed message";

    nbgl_useCaseAdvancedReview(operationType,
                               g_pairsList,
                               mcp_active ? get_app_icon(false) : &ICON_APP_REVIEW,
                               review_title,
                               NULL,
                               g_finishMsg,
                               NULL,
                               &warning,
                               choiceCallback);
}
```

- [ ] **Step 2: Verify build compiles**

Run:
```bash
cd device_app && make clean && make BOLOS_SDK=$LEDGER_SDK DEBUG=1 2>&1 | tail -20
```
Expected: Build succeeds. `get_app_icon` is already declared in `ui_nbgl.h` and included via `ui_nbgl.h` → `ui_home.c`. Verify `ui_sign_712.c` includes `ui_nbgl.h` (it does, line 4).

- [ ] **Step 3: Commit**

```bash
cd device_app
git add src/nbgl/ui_sign_712.c
git commit -m "feat: MCP-aware review titles and Polyledger icon in signing flow"
```

---

### Task 6: Reorder MCP screens (money-first)

**Files:**
- Modify: `device_app/src/features/sign_message_eip712/ui_logic.c:1054-1080`

- [ ] **Step 1: Reorder MCP pair chain**

In `device_app/src/features/sign_message_eip712/ui_logic.c`, replace the `ui_712_inject_mcp_screens` function (lines 1054-1080) with:
```c
static void ui_712_inject_mcp_screens(void) {
    if (!market_context_is_valid()) return;

    // Build chain: Market -> Outcome -> Total -> Shares -> Price/Share
    // (money-first: user sees market, side, and USDC amount in first 3 screens)
    s_ui_712_pair *market = mcp_alloc_pair("Market", g_market_context.market_name);
    s_ui_712_pair *outcome = mcp_alloc_pair("Outcome", g_market_context.market_outcome);
    s_ui_712_pair *amount = mcp_alloc_pair("Total", g_market_context.market_amount);
    s_ui_712_pair *shares = mcp_alloc_pair("Shares", g_market_context.market_shares);
    s_ui_712_pair *price = mcp_alloc_pair("Price/Share", g_market_context.market_price);

    if (!market || !outcome || !amount || !shares || !price) {
        PRINTF("[MCP] Failed to allocate MCP UI pairs\n");
        return;
    }

    // Link the chain
    ((flist_node_t *) market)->next = (flist_node_t *) outcome;
    ((flist_node_t *) outcome)->next = (flist_node_t *) amount;
    ((flist_node_t *) amount)->next = (flist_node_t *) shares;
    ((flist_node_t *) shares)->next = (flist_node_t *) price;

    // Prepend to existing list
    ((flist_node_t *) price)->next = (flist_node_t *) ui_ctx->ui_pairs;
    ui_ctx->ui_pairs = market;

    PRINTF("[MCP] Injected 5 MCP UI screens at front\n");
}
```

- [ ] **Step 2: Verify build compiles**

Run:
```bash
cd device_app && make clean && make BOLOS_SDK=$LEDGER_SDK DEBUG=1 2>&1 | tail -20
```
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
cd device_app
git add src/features/sign_message_eip712/ui_logic.c
git commit -m "feat: reorder MCP screens to money-first (Market, Outcome, Total, Shares, Price)"
```

---

### Task 7: Run tests and regenerate snapshots

**Files:**
- Test: `device_app/tests/ragger/test_market_context.py`

- [ ] **Step 1: Run the MCP test suite**

```bash
cd device_app && python -m pytest tests/ragger/test_market_context.py -v --device flex 2>&1
```
Expected: Some snapshot tests may fail due to changed text ("Polyledger" instead of "Ethereum", "Review order" instead of "Review typed message", reordered MCP screens). Functional tests (APDU accepted, signature verification, chain_id mismatch) should still pass.

- [ ] **Step 2: Regenerate failing snapshots**

If snapshot tests fail, regenerate them:
```bash
cd device_app && python -m pytest tests/ragger/test_market_context.py -v --device flex --golden_run 2>&1
```
Expected: Snapshots regenerated in `tests/ragger/snapshots/flex/`.

- [ ] **Step 3: Re-run tests to confirm all pass**

```bash
cd device_app && python -m pytest tests/ragger/test_market_context.py -v --device flex 2>&1
```
Expected: All tests PASS.

- [ ] **Step 4: Commit regenerated snapshots**

```bash
cd device_app
git add tests/ragger/snapshots/flex/
git commit -m "test: regenerate Flex snapshots after Polyledger rebrand"
```

---

### Task 8: Final build verification

- [ ] **Step 1: Clean build from scratch**

```bash
cd device_app && make clean && make BOLOS_SDK=$LEDGER_SDK DEBUG=1 2>&1 | tail -30
```
Expected: Build succeeds with no errors and no new warnings.

- [ ] **Step 2: Run full test suite**

```bash
cd device_app && python -m pytest tests/ragger/ -v --device flex 2>&1
```
Expected: All tests pass. Some non-MCP snapshot tests (e.g., `test_get_pk`, `test_blind_sign`) may also fail due to "Polyledger" name change on home screens — regenerate those too if needed:
```bash
cd device_app && python -m pytest tests/ragger/ -v --device flex --golden_run 2>&1
```
Then re-run to confirm:
```bash
cd device_app && python -m pytest tests/ragger/ -v --device flex 2>&1
```

- [ ] **Step 3: Commit any remaining snapshot updates**

```bash
cd device_app
git add tests/ragger/snapshots/flex/
git commit -m "test: regenerate remaining Flex snapshots after rebrand"
```
