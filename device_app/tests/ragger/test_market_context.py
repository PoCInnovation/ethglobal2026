import json
import os
from typing import Optional

import pytest
from ragger.navigator import NavigateWithScenario
from ragger.backend import BackendInterface

import client.response_parser as ResponseParser
from client.client import EthAppClient
from client.eip712 import InputData
from client.settings import SettingID, settings_toggle
from client.utils import recover_message


BIP32_PATH = "m/44'/60'/0'/0/0"
DEVICE_ADDR: Optional[bytes] = None


def _polymarket_order_data() -> dict:
    path = os.path.join(os.path.dirname(__file__),
                        "eip712_input_files",
                        "polymarket-order-data.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def set_wallet_addr(backend: BackendInterface) -> bytes:
    global DEVICE_ADDR
    if DEVICE_ADDR is None:
        client = EthAppClient(backend)
        with client.get_public_addr(display=False):
            pass
        _, DEVICE_ADDR, _ = ResponseParser.pk_addr(client.response().data)


@pytest.fixture(autouse=True)
def init_wallet_addr(backend: BackendInterface):
    set_wallet_addr(backend)


def test_polymarket_eip712_baseline(scenario_navigator: NavigateWithScenario):
    """Polymarket Order signs successfully without MCP (baseline non-regression)."""
    app_client = EthAppClient(scenario_navigator.backend)
    data = _polymarket_order_data()

    settings_toggle(scenario_navigator.backend.device,
                    scenario_navigator.navigator,
                    [SettingID.BLIND_SIGNING])

    InputData.process_data(app_client, data)
    with app_client.eip712_sign_new(BIP32_PATH):
        scenario_navigator.review_approve_with_warning(do_comparison=False)

    vrs = ResponseParser.signature(app_client.response().data)
    assert DEVICE_ADDR == recover_message(data, vrs)


SAMPLE_TOKEN_ID = bytes.fromhex(
    "DEADBEEFCAFEBABE1234567890ABCDEF"
    "12345678901234567890ABCDEF123456"
)

# The tokenId from polymarket-order-data.json as bytes (uint256 big-endian)
POLYMARKET_ORDER_TOKEN_ID = bytes.fromhex(
    "df2d9709d71cc5fe53bbf419d265903c917d961a93cfebeffc015d31e68666f8"
)


def test_mcp_apdu_accepted(backend):
    """INS_PROVIDE_MARKET_CONTEXT (0x3A) returns 0x9000 for a valid payload."""
    from client.market_context import MarketContext

    app_client = EthAppClient(backend)
    mcp = MarketContext(
        token_id=SAMPLE_TOKEN_ID,
        chain_id=137,
        market_name="Will Trump win the 2026 midterms?",
        market_outcome="YES",
        market_amount="50.00 USDC",
    )
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000


def test_mcp_invalid_signature_rejected(backend):
    """Invalid signature on MCP payload returns SWO_INCORRECT_DATA (0x6A80)."""
    from client.market_context import MarketContext

    app_client = EthAppClient(backend)
    mcp = MarketContext(
        token_id=bytes(32),
        chain_id=137,
        market_name="Test Market",
        market_outcome="YES",
        market_amount="10.00 USDC",
    )
    # Corrupt the payload by flipping bytes in the signature region
    blob = bytearray(mcp.serialize())
    blob[-3] ^= 0xFF
    blob[-2] ^= 0xFF
    blob[-1] ^= 0xFF
    corrupted = bytes(blob)

    from ragger.error import ExceptionRAPDU

    chunks = app_client._cmd_builder.provide_market_context(corrupted)
    with pytest.raises(ExceptionRAPDU) as exc_info:
        for chunk in chunks:
            backend.exchange_raw(chunk)
    assert exc_info.value.status == 0x6A80, \
        f"Expected 0x6A80 (INCORRECT_DATA), got {exc_info.value.status:#06x}"


def test_mcp_chain_id_mismatch_aborts_sign(backend, scenario_navigator: NavigateWithScenario):
    """MCP with wrong chain_id causes signing to abort with SWO_INCORRECT_DATA."""
    from client.market_context import MarketContext

    app_client = EthAppClient(backend)
    data = _polymarket_order_data()

    # MCP says chain_id=1 (Ethereum mainnet) but EIP-712 domain says chainId=137 (Polygon)
    mcp = MarketContext(
        token_id=bytes(32),
        chain_id=1,  # WRONG chain
        market_name="Test Market",
        market_outcome="YES",
        market_amount="10.00 USDC",
    )
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000  # MCP itself accepted OK

    settings_toggle(backend.device,
                    scenario_navigator.navigator,
                    [SettingID.BLIND_SIGNING])

    # The sign should fail during binding check
    with pytest.raises(Exception):
        InputData.process_data(app_client, data)
        with app_client.eip712_sign_new(BIP32_PATH):
            scenario_navigator.review_approve_with_warning(do_comparison=False)


def test_mcp_expired_payload_rejected(backend):
    """MCP with expires_at <= issued_at is rejected as invalid (0x6A80)."""
    from client.market_context import MarketContext

    app_client = EthAppClient(backend)
    mcp = MarketContext(
        token_id=SAMPLE_TOKEN_ID,
        chain_id=137,
        market_name="Test Market",
        market_outcome="YES",
        market_amount="10.00 USDC",
        ttl_seconds=-10,  # expires_at will be BEFORE issued_at
    )

    from ragger.error import ExceptionRAPDU
    with pytest.raises(ExceptionRAPDU) as exc_info:
        app_client.provide_market_context(mcp)
    assert exc_info.value.status == 0x6A80


def test_mcp_screens_appear_before_eip712(scenario_navigator: NavigateWithScenario):
    """MCP screens (Market, Outcome, Amount) appear before EIP-712 fields."""
    from client.market_context import MarketContext

    app_client = EthAppClient(scenario_navigator.backend)
    data = _polymarket_order_data()

    mcp = MarketContext(
        token_id=POLYMARKET_ORDER_TOKEN_ID,
        chain_id=137,
        market_name="Will Trump win the 2026 midterms?",
        market_outcome="YES",
        market_amount="50.00 USDC",
    )
    # Send MCP FIRST, then sign
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000

    settings_toggle(scenario_navigator.backend.device,
                    scenario_navigator.navigator,
                    [SettingID.BLIND_SIGNING])

    InputData.process_data(app_client, data)
    with app_client.eip712_sign_new(BIP32_PATH):
        scenario_navigator.review_approve_with_warning(do_comparison=False)

    vrs = ResponseParser.signature(app_client.response().data)
    assert DEVICE_ADDR == recover_message(data, vrs)


def test_mcp_token_id_mismatch_aborts_sign(backend, scenario_navigator: NavigateWithScenario):
    """MCP with wrong tokenId causes signing to abort with SWO_INCORRECT_DATA."""
    from client.market_context import MarketContext

    app_client = EthAppClient(backend)
    data = _polymarket_order_data()

    # MCP token_id does NOT match the tokenId in the EIP-712 Order
    wrong_token_id = bytes(32)  # all zeros — doesn't match order's tokenId
    mcp = MarketContext(
        token_id=wrong_token_id,
        chain_id=137,
        market_name="Test Market",
        market_outcome="YES",
        market_amount="10.00 USDC",
    )
    response = app_client.provide_market_context(mcp)
    assert response.status == 0x9000  # MCP itself accepted

    settings_toggle(backend.device,
                    scenario_navigator.navigator,
                    [SettingID.BLIND_SIGNING])

    with pytest.raises(Exception):
        InputData.process_data(app_client, data)
        with app_client.eip712_sign_new(BIP32_PATH):
            scenario_navigator.review_approve_with_warning(do_comparison=False)
