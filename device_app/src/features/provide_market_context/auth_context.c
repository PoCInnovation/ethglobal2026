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
