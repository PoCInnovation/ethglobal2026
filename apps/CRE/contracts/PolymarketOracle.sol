// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}

contract PolymarketOracle {

    struct MarketInfo {
        bytes32 conditionId; // Polymarket condition ID (unique key)
        string question;     // Market title displayed on Ledger
        uint256 endDate;     // Unix timestamp — market expiry
        bool active;         // Whether the market is still tradable
        uint256 lastUpdate;  // Block timestamp of last CRE update
    }

    address public immutable EXPECTED_AUTHOR;

    bytes10 public immutable EXPECTED_WORKFLOW_NAME;

    address public immutable ADMIN;

    // Chainlink Price Feed: USDC/USD (8 decimals)
    AggregatorV3Interface public immutable USDC_PRICE_FEED;

    uint256 public constant DEPEG_THRESHOLD_LOW = 0.95e8;  // $0.95
    uint256 public constant DEPEG_THRESHOLD_HIGH = 1.05e8; // $1.05

    mapping(bytes32 => MarketInfo) public markets;

    bytes32[] public conditionIds;

    event MarketsUpdated(uint256 count, uint256 timestamp);
    event PriceChecked(int256 usdcPrice, uint256 timestamp);

    error InvalidAuthor(address received, address expected);
    error InvalidWorkflowName(bytes10 received, bytes10 expected);
    error Unauthorized();
    error USDCDepeg(int256 price);
    error StalePriceFeed(uint256 updatedAt);

    constructor(address workflowOwner, bytes10 workflowName, address admin, address usdcPriceFeed) {
        EXPECTED_AUTHOR = workflowOwner;
        EXPECTED_WORKFLOW_NAME = workflowName;
        ADMIN = admin;
        USDC_PRICE_FEED = AggregatorV3Interface(usdcPriceFeed);
    }

    // Called by the CRE DON — verifies workflow identity before storing data.
    function onReport(bytes calldata metadata, bytes calldata report) external {
        (address workflowOwner, bytes10 workflowName) = _decodeMetadata(metadata);

        if (workflowOwner != EXPECTED_AUTHOR) {
            revert InvalidAuthor(workflowOwner, EXPECTED_AUTHOR);
        }
        if (workflowName != EXPECTED_WORKFLOW_NAME) {
            revert InvalidWorkflowName(workflowName, EXPECTED_WORKFLOW_NAME);
        }

        MarketInfo[] memory incoming = abi.decode(report[4:], (MarketInfo[]));

        _storeMarkets(incoming);
    }

    // Admin bypass for testing without the DON.
    function updateMarketsDirect(MarketInfo[] calldata incoming) external {
        if (msg.sender != ADMIN) revert Unauthorized();
        _storeMarkets(incoming);
    }

    // Returns stored market data by condition ID.
    function getMarket(bytes32 conditionId) external view returns (MarketInfo memory) {
        return markets[conditionId];
    }

    // Returns all condition IDs for markets currently marked active.
    function getActiveConditionIds() external view returns (bytes32[] memory) {
        uint256 count;
        for (uint256 i = 0; i < conditionIds.length; i++) {
            if (markets[conditionIds[i]].active) count++;
        }

        bytes32[] memory result = new bytes32[](count);
        uint256 j;
        for (uint256 i = 0; i < conditionIds.length; i++) {
            if (markets[conditionIds[i]].active) {
                result[j++] = conditionIds[i];
            }
        }
        return result;
    }

    // Returns total number of markets ever stored.
    function totalMarkets() external view returns (uint256) {
        return conditionIds.length;
    }

    // Reads USDC/USD from Chainlink. Reverts if stale (>24h) or depegged (<$0.95 or >$1.05).
    function getUSDCPrice() public view returns (int256 price) {
        uint256 updatedAt;
        (, price,, updatedAt,) = USDC_PRICE_FEED.latestRoundData();

        if (block.timestamp - updatedAt > 24 hours) {
            revert StalePriceFeed(updatedAt);
        }

        if (price < int256(DEPEG_THRESHOLD_LOW) || price > int256(DEPEG_THRESHOLD_HIGH)) {
            revert USDCDepeg(price);
        }
    }

    // Validates USDC peg before a trade. Emits PriceChecked on success.
    function validateTradePrice(uint256 amount) external returns (int256 price) {
        price = getUSDCPrice();
        emit PriceChecked(price, block.timestamp);
    }

    // ERC-165: supports IReceiver (0x2a7dba02) and IERC165 (0x01ffc9a7).
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x2a7dba02 || interfaceId == 0x01ffc9a7;
    }

    function _decodeMetadata(
        bytes calldata metadata
    ) internal pure returns (address workflowOwner, bytes10 workflowName) {
        (workflowOwner, workflowName) = abi.decode(metadata, (address, bytes10));
    }

    function _storeMarkets(MarketInfo[] memory incoming) internal {
        for (uint256 i = 0; i < incoming.length; i++) {
            MarketInfo memory m = incoming[i];
            m.lastUpdate = block.timestamp;

            if (markets[m.conditionId].lastUpdate == 0) {
                conditionIds.push(m.conditionId);
            }

            markets[m.conditionId] = m;
        }

        emit MarketsUpdated(incoming.length, block.timestamp);
    }
}
