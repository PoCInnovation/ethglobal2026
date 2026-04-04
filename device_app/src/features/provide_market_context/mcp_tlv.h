#pragma once

#include <stdint.h>
#include <stdbool.h>
#include "tlv_library.h"

#define MCP_STRUCT_TYPE    0x0A
#define MCP_STRUCT_VERSION 0x01
#define MCP_MAX_PAYLOAD    1024
#define MCP_MAX_FIELD_LEN  128

// Auth struct type for ClobAuth clear signing
#define MCP_AUTH_STRUCT_TYPE  0x0B

// TLV tag constants for Auth Context (ClobAuth)
#define TAG_MCP_AUTH_LABEL   0x70
#define TAG_MCP_AUTH_ADDRESS 0x71

// TLV tag constants for Market Context Protocol
#define TAG_MCP_STRUCT_TYPE    0x01
#define TAG_MCP_STRUCT_VERSION 0x02
#define TAG_MCP_CHAIN_ID       0x23
#define TAG_MCP_TOKEN_ID       0x60
#define TAG_MCP_ISSUED_AT      0x61
#define TAG_MCP_EXPIRES_AT     0x62
#define TAG_MCP_ATTESTER_ID    0x63
#define TAG_MCP_MARKET_NAME    0x64
#define TAG_MCP_MARKET_OUTCOME 0x65
#define TAG_MCP_MARKET_AMOUNT  0x66
#define TAG_MCP_MARKET_SHARES  0x67
#define TAG_MCP_MARKET_PRICE   0x68
#define TAG_MCP_DER_SIGNATURE  0x15

bool mcp_parse_payload(const buffer_t *buf);
