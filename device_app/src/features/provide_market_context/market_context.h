#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "common_utils.h"

#define MCP_MARKET_NAME_MAX    128
#define MCP_MARKET_OUTCOME_MAX 16
#define MCP_MARKET_AMOUNT_MAX  32
#define MCP_MARKET_SHARES_MAX  32
#define MCP_MARKET_PRICE_MAX   32
#define MCP_MARKET_SIDE_MAX    16

typedef struct {
    bool valid;      // payload received and parsed OK
    bool verified;   // signature verified OK
    uint64_t chain_id;
    uint8_t token_id[INT256_LENGTH];
    uint32_t issued_at;
    uint32_t expires_at;
    uint8_t attester_id;
    char market_name[MCP_MARKET_NAME_MAX + 1];
    char market_outcome[MCP_MARKET_OUTCOME_MAX + 1];
    char market_amount[MCP_MARKET_AMOUNT_MAX + 1];
    char market_shares[MCP_MARKET_SHARES_MAX + 1];
    char market_price[MCP_MARKET_PRICE_MAX + 1];
    char market_side[MCP_MARKET_SIDE_MAX + 1];
} market_context_t;

// Global MCP state
extern market_context_t g_market_context;

// Set when a new MCP APDU is received; consumed by eip712_context_init
// so that stale context from a previous signing is cleared.
extern bool g_market_context_fresh;

void market_context_clear(void);
bool market_context_is_valid(void);
void market_context_consume_or_clear(void);

// Storage for tokenId extracted from EIP-712 message during parsing.
// Used to bind MCP context to the actual signed message.
extern uint8_t g_eip712_extracted_token_id[INT256_LENGTH];
extern bool g_eip712_token_id_extracted;

void market_context_clear_eip712_binding(void);
