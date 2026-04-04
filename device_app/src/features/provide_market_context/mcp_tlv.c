#include "market_context.h"
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
    pctx->ctx->issued_at = (uint32_t) data->value.ptr[0] << 24 |
                            (uint32_t) data->value.ptr[1] << 16 |
                            (uint32_t) data->value.ptr[2] << 8 |
                            (uint32_t) data->value.ptr[3];
    return true;
}

static bool parse_expires_at(const tlv_data_t *data, s_mcp_parse_ctx *pctx) {
    if (data->value.size != 4) return false;
    pctx->ctx->expires_at = (uint32_t) data->value.ptr[0] << 24 |
                             (uint32_t) data->value.ptr[1] << 16 |
                             (uint32_t) data->value.ptr[2] << 8 |
                             (uint32_t) data->value.ptr[3];
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
    buffer_t sig = {0};
    if (!get_buffer_from_tlv_data(data,
                                  &sig,
                                  CX_ECDSA_SHA256_SIG_MIN_ASN1_LENGTH,
                                  CX_ECDSA_SHA256_SIG_MAX_ASN1_LENGTH)) {
        PRINTF("[MCP] DER_SIGNATURE: failed to extract\n");
        return false;
    }
    pctx->sig_size = sig.size;
    pctx->sig = sig.ptr;
    return true;
}

static bool mcp_common_handler(const tlv_data_t *data, s_mcp_parse_ctx *pctx);

#define MCP_TAGS(X)                                                                        \
    X(TAG_MCP_STRUCT_TYPE, TAG_STRUCT_TYPE, parse_struct_type, ENFORCE_UNIQUE_TAG)          \
    X(TAG_MCP_STRUCT_VERSION, TAG_STRUCT_VER, parse_struct_version, ENFORCE_UNIQUE_TAG)     \
    X(TAG_MCP_CHAIN_ID, TAG_CHAIN, parse_chain_id, ENFORCE_UNIQUE_TAG)                     \
    X(TAG_MCP_TOKEN_ID, TAG_TOKEN, parse_token_id, ENFORCE_UNIQUE_TAG)                     \
    X(TAG_MCP_ISSUED_AT, TAG_ISSUED, parse_issued_at, ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_EXPIRES_AT, TAG_EXPIRES, parse_expires_at, ENFORCE_UNIQUE_TAG)               \
    X(TAG_MCP_ATTESTER_ID, TAG_ATTESTER, parse_attester_id, ENFORCE_UNIQUE_TAG)            \
    X(TAG_MCP_MARKET_NAME, TAG_MKT_NAME, parse_market_name, ENFORCE_UNIQUE_TAG)            \
    X(TAG_MCP_MARKET_OUTCOME, TAG_MKT_OUT, parse_market_outcome, ENFORCE_UNIQUE_TAG)       \
    X(TAG_MCP_MARKET_AMOUNT, TAG_MKT_AMT, parse_market_amount, ENFORCE_UNIQUE_TAG)         \
    X(TAG_MCP_DER_SIGNATURE, TAG_DER_SIG, parse_signature, ENFORCE_UNIQUE_TAG)

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

    if (finalize_hash((cx_hash_t *) &pctx->hash_ctx, hash, sizeof(hash)) != true) {
        PRINTF("[MCP] Failed to finalize hash\n");
        return false;
    }

    return check_signature_with_pubkey(hash,
                                       sizeof(hash),
                                       MCP_ATTESTER_PUBLIC_KEY,
                                       MCP_ATTESTER_PUBLIC_KEY_LEN,
                                       0,  // keyUsageExp unused with direct pubkey
                                       (uint8_t *) pctx->sig,
                                       pctx->sig_size);
}

static bool mcp_verify_mandatory_tags(const s_mcp_parse_ctx *pctx) {
    return TLV_CHECK_RECEIVED_TAGS(pctx->received_tags,
                                   TAG_STRUCT_TYPE,
                                   TAG_STRUCT_VER,
                                   TAG_CHAIN,
                                   TAG_TOKEN,
                                   TAG_ISSUED,
                                   TAG_EXPIRES,
                                   TAG_MKT_NAME,
                                   TAG_MKT_OUT,
                                   TAG_MKT_AMT,
                                   TAG_DER_SIG);
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
