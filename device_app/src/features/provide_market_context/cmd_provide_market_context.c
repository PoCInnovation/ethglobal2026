#include "cmd_provide_market_context.h"
#include "mcp_tlv.h"
#include "auth_tlv.h"
#include "market_context.h"
#include "auth_context.h"
#include "apdu_constants.h"
#include "tlv_apdu.h"

/**
 * Routing callback: peek at the struct type byte in the first TLV tag
 * to decide which parser handles the payload.
 *
 * Layout of first TLV: tag(1) + length(1) + value(1)
 * - tag must be TAG_MCP_STRUCT_TYPE (0x01)
 * - length must be 1
 * - value: 0x0A → order (mcp_parse_payload), 0x0B → auth (auth_parse_payload)
 */
static bool route_by_struct_type(const buffer_t *buf) {
    if (buf->size < 3) {
        PRINTF("[MCP] Payload too short for struct type peek\n");
        return false;
    }

    uint8_t tag = buf->ptr[buf->offset];
    uint8_t len = buf->ptr[buf->offset + 1];
    uint8_t val = buf->ptr[buf->offset + 2];

    if (tag != TAG_MCP_STRUCT_TYPE || len != 1) {
        PRINTF("[MCP] Invalid struct type tag: tag=0x%02X len=%u\n", tag, len);
        return false;
    }

    if (val == MCP_STRUCT_TYPE) {
        return mcp_parse_payload(buf);
    } else if (val == MCP_AUTH_STRUCT_TYPE) {
        return auth_parse_payload(buf);
    } else {
        PRINTF("[MCP] Unknown struct type: 0x%02X\n", val);
        return false;
    }
}

uint16_t handle_provide_market_context(uint8_t p1,
                                       uint8_t p2,
                                       const uint8_t *data,
                                       uint8_t length) {
    UNUSED(p1);
    if (!tlv_from_apdu(p2 == P1_FIRST_CHUNK, length, data, &route_by_struct_type)) {
        PRINTF("[MCP] APDU handler: tlv_from_apdu failed\n");
        return SWO_INCORRECT_DATA;
    }
    return SWO_SUCCESS;
}
