/**
 * Fuzzing harness for the MCP (Market Context Protocol) TLV parser.
 * Feeds arbitrary bytes into mcp_parse_payload() to detect crashes,
 * buffer overflows, or undefined behavior.
 */

#include "fuzz_utils.h"
#include "mcp_tlv.h"
#include "market_context.h"

static int fuzz_mcp(const uint8_t *data, size_t size) {
    buffer_t buf = {0};

    // mcp_parse_payload expects a buffer_t
    buf.ptr = data;
    buf.size = size;
    buf.offset = 0;

    // Call the parser — it should handle any input gracefully
    mcp_parse_payload(&buf);

    // Clean up global state for next iteration
    market_context_clear();

    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size) {
    // Reject unreasonably large inputs (MCP max payload is 1024)
    if (size > 2048) {
        return 0;
    }

    init_fuzzing_environment();
    fuzz_mcp(data, size);
    return 0;
}
