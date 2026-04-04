import time
from .tlv import TlvSerializable, FieldTag
from .keychain import sign_data, Key

MCP_STRUCT_TYPE = 0x0A
MCP_STRUCT_VERSION = 0x01


class MarketContext(TlvSerializable):
    """TLV-serializable Polymarket MCP attestation payload."""

    def __init__(
        self,
        token_id: bytes,           # 32 bytes
        chain_id: int,             # Polygon = 137
        market_name: str,          # "Will Trump win 2026?"
        market_outcome: str,       # "YES" or "NO"
        market_amount: str,        # "50.00 USDC"
        attester_id: int = 0,
        ttl_seconds: int = 300,
    ) -> None:
        assert len(token_id) == 32, "token_id must be 32 bytes"
        self.token_id = token_id
        self.chain_id = chain_id
        self.market_name = market_name
        self.market_outcome = market_outcome
        self.market_amount = market_amount
        self.attester_id = attester_id
        self.issued_at = int(time.time())
        self.expires_at = self.issued_at + ttl_seconds

    def serialize(self) -> bytes:
        payload: bytes = b""
        payload += self.serialize_field(FieldTag.STRUCT_TYPE, MCP_STRUCT_TYPE)
        payload += self.serialize_field(FieldTag.STRUCT_VERSION, MCP_STRUCT_VERSION)
        payload += self.serialize_field(FieldTag.CHAIN_ID, self.chain_id.to_bytes(8, "big"))
        payload += self.serialize_field(FieldTag.MCP_TOKEN_ID, self.token_id)
        payload += self.serialize_field(FieldTag.MCP_ISSUED_AT, self.issued_at.to_bytes(4, "big"))
        payload += self.serialize_field(FieldTag.MCP_EXPIRES_AT, self.expires_at.to_bytes(4, "big"))
        payload += self.serialize_field(FieldTag.MCP_ATTESTER_ID, self.attester_id)
        payload += self.serialize_field(FieldTag.MCP_MARKET_NAME, self.market_name.encode("utf-8"))
        payload += self.serialize_field(FieldTag.MCP_MARKET_OUTCOME, self.market_outcome.encode("utf-8"))
        payload += self.serialize_field(FieldTag.MCP_MARKET_AMOUNT, self.market_amount.encode("utf-8"))
        # Sign all tags before DER_SIGNATURE
        payload += self.serialize_field(
            FieldTag.DER_SIGNATURE,
            sign_data(Key.POLYMARKET_MCP, payload)
        )
        return payload
