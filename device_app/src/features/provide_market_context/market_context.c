#include "market_context.h"
#include "os.h"

market_context_t g_market_context = {0};

void market_context_clear(void) {
    explicit_bzero(&g_market_context, sizeof(g_market_context));
}

bool market_context_is_valid(void) {
    return g_market_context.valid && g_market_context.verified;
}
