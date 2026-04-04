#include "market_context.h"
#include "os.h"

market_context_t g_market_context = {0};
bool g_market_context_fresh = false;

uint8_t g_eip712_extracted_token_id[INT256_LENGTH] = {0};
bool g_eip712_token_id_extracted = false;

void market_context_clear_eip712_binding(void) {
    explicit_bzero(g_eip712_extracted_token_id, sizeof(g_eip712_extracted_token_id));
    g_eip712_token_id_extracted = false;
}

void market_context_clear(void) {
    explicit_bzero(&g_market_context, sizeof(g_market_context));
    market_context_clear_eip712_binding();
}

bool market_context_is_valid(void) {
    return g_market_context.valid && g_market_context.verified;
}

/**
 * Called at the start of EIP-712 context init.
 * If a fresh MCP was received for this signing session, keep it.
 * Otherwise, clear stale context from a previous signing.
 */
void market_context_consume_or_clear(void) {
    if (g_market_context_fresh) {
        // MCP was just received — keep it, mark as consumed
        g_market_context_fresh = false;
    } else {
        // No fresh MCP — clear stale context
        market_context_clear();
    }
}
