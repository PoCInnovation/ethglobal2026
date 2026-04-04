#include "auth_context.h"
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
    auth_context_t *ctx;
    cx_sha256_t hash_ctx;
    const uint8_t *sig;
    uint8_t sig_size;
    TLV_reception_t received_tags;
} s_auth_parse_ctx;

static bool auth_parse_struct_type(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    UNUSED(pctx);
    return tlv_check_struct_type(data, MCP_AUTH_STRUCT_TYPE);
}

static bool auth_parse_struct_version(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    UNUSED(pctx);
    return tlv_check_struct_version(data, MCP_STRUCT_VERSION);
}

static bool auth_parse_chain_id(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    return tlv_get_chain_id(data, &pctx->ctx->chain_id);
}

static bool auth_parse_issued_at(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    if (data->value.size != 4) return false;
    pctx->ctx->issued_at = (uint32_t) data->value.ptr[0] << 24 |
                            (uint32_t) data->value.ptr[1] << 16 |
                            (uint32_t) data->value.ptr[2] << 8 |
                            (uint32_t) data->value.ptr[3];
    return true;
}

static bool auth_parse_expires_at(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    if (data->value.size != 4) return false;
    pctx->ctx->expires_at = (uint32_t) data->value.ptr[0] << 24 |
                             (uint32_t) data->value.ptr[1] << 16 |
                             (uint32_t) data->value.ptr[2] << 8 |
                             (uint32_t) data->value.ptr[3];
    return true;
}

static bool auth_parse_string_field(const tlv_data_t *data, char *buf, size_t max_len) {
    size_t copy_len = data->value.size < max_len ? data->value.size : max_len;
    memmove(buf, data->value.ptr, copy_len);
    buf[copy_len] = '\0';
    return true;
}

static bool auth_parse_label(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    return auth_parse_string_field(data, pctx->ctx->auth_label, MCP_AUTH_LABEL_MAX);
}

static bool auth_parse_address(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    return auth_parse_string_field(data, pctx->ctx->auth_address, MCP_AUTH_ADDRESS_MAX);
}

static bool auth_parse_signature(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    buffer_t sig = {0};
    if (!get_buffer_from_tlv_data(data,
                                  &sig,
                                  CX_ECDSA_SHA256_SIG_MIN_ASN1_LENGTH,
                                  CX_ECDSA_SHA256_SIG_MAX_ASN1_LENGTH)) {
        PRINTF("[AUTH] DER_SIGNATURE: failed to extract\n");
        return false;
    }
    pctx->sig_size = sig.size;
    pctx->sig = sig.ptr;
    return true;
}

static bool auth_common_handler(const tlv_data_t *data, s_auth_parse_ctx *pctx);

#define AUTH_TAGS(X)                                                                            \
    X(TAG_MCP_STRUCT_TYPE, TAG_STRUCT_TYPE, auth_parse_struct_type, ENFORCE_UNIQUE_TAG)         \
    X(TAG_MCP_STRUCT_VERSION, TAG_STRUCT_VER, auth_parse_struct_version, ENFORCE_UNIQUE_TAG)    \
    X(TAG_MCP_CHAIN_ID, TAG_CHAIN, auth_parse_chain_id, ENFORCE_UNIQUE_TAG)                    \
    X(TAG_MCP_ISSUED_AT, TAG_ISSUED, auth_parse_issued_at, ENFORCE_UNIQUE_TAG)                 \
    X(TAG_MCP_EXPIRES_AT, TAG_EXPIRES, auth_parse_expires_at, ENFORCE_UNIQUE_TAG)              \
    X(TAG_MCP_AUTH_LABEL, TAG_LABEL, auth_parse_label, ENFORCE_UNIQUE_TAG)                     \
    X(TAG_MCP_AUTH_ADDRESS, TAG_ADDR, auth_parse_address, ENFORCE_UNIQUE_TAG)                  \
    X(TAG_MCP_DER_SIGNATURE, TAG_DER_SIG, auth_parse_signature, ENFORCE_UNIQUE_TAG)

DEFINE_TLV_PARSER(AUTH_TAGS, &auth_common_handler, auth_tlv_parser)

static bool auth_common_handler(const tlv_data_t *data, s_auth_parse_ctx *pctx) {
    // Hash all tags except the signature itself
    if (data->tag != TAG_MCP_DER_SIGNATURE) {
        hash_nbytes(data->raw.ptr, data->raw.size, (cx_hash_t *) &pctx->hash_ctx);
    }
    return true;
}

static bool auth_verify_signature(const s_auth_parse_ctx *pctx) {
    uint8_t hash[INT256_LENGTH] = {0};

    if (finalize_hash((cx_hash_t *) &pctx->hash_ctx, hash, sizeof(hash)) != true) {
        PRINTF("[AUTH] Failed to finalize hash\n");
        return false;
    }

    return check_signature_with_pubkey(hash,
                                       sizeof(hash),
                                       MCP_ATTESTER_PUBLIC_KEY,
                                       MCP_ATTESTER_PUBLIC_KEY_LEN,
                                       0,
                                       (uint8_t *) pctx->sig,
                                       pctx->sig_size);
}

static bool auth_verify_mandatory_tags(const s_auth_parse_ctx *pctx) {
    return TLV_CHECK_RECEIVED_TAGS(pctx->received_tags,
                                   TAG_STRUCT_TYPE,
                                   TAG_STRUCT_VER,
                                   TAG_CHAIN,
                                   TAG_ISSUED,
                                   TAG_EXPIRES,
                                   TAG_LABEL,
                                   TAG_ADDR,
                                   TAG_DER_SIG);
}

bool auth_parse_payload(const buffer_t *buf) {
    s_auth_parse_ctx pctx = {0};
    pctx.ctx = &g_auth_context;
    auth_context_clear();
    cx_sha256_init(&pctx.hash_ctx);

    if (!auth_tlv_parser(buf, &pctx, &pctx.received_tags)) {
        PRINTF("[AUTH] TLV parse failed\n");
        return false;
    }
    if (!auth_verify_mandatory_tags(&pctx)) {
        PRINTF("[AUTH] Missing mandatory tags\n");
        return false;
    }
    // TTL sanity: expires_at must be strictly after issued_at
    if (g_auth_context.expires_at <= g_auth_context.issued_at) {
        PRINTF("[AUTH] TTL sanity failed: expires_at(%u) <= issued_at(%u)\n",
               g_auth_context.expires_at,
               g_auth_context.issued_at);
        auth_context_clear();
        return false;
    }
    g_auth_context.valid = true;
    if (!auth_verify_signature(&pctx)) {
        PRINTF("[AUTH] Signature verification failed\n");
        auth_context_clear();
        return false;
    }
    g_auth_context.verified = true;
    g_auth_context_fresh = true;
    PRINTF("[AUTH] Valid auth context: %s | %s\n",
           g_auth_context.auth_label,
           g_auth_context.auth_address);
    return true;
}
