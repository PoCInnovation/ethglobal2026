#include "cmd_provide_market_context.h"
#include "mcp_tlv.h"
#include "market_context.h"
#include "apdu_constants.h"
#include "tlv_apdu.h"

uint16_t handle_provide_market_context(uint8_t p1,
                                       uint8_t p2,
                                       const uint8_t *data,
                                       uint8_t length) {
    UNUSED(p1);
    if (!tlv_from_apdu(p2 == P1_FIRST_CHUNK, length, data, &mcp_parse_payload)) {
        PRINTF("[MCP] APDU handler: tlv_from_apdu failed\n");
        return SWO_INCORRECT_DATA;
    }
    return SWO_SUCCESS;
}
