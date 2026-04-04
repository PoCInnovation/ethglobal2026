#include "market_context.h"
#include "os.h"

market_context_t g_market_context = {0};

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
