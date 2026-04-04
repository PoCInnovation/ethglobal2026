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
