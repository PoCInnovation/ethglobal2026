// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

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

    mapping(bytes32 => MarketInfo) public markets;

    bytes32[] public conditionIds;

    event MarketsUpdated(uint256 count, uint256 timestamp);

    error InvalidAuthor(address received, address expected);
    error InvalidWorkflowName(bytes10 received, bytes10 expected);
    error Unauthorized();

    constructor(address workflowOwner, bytes10 workflowName, address admin) {
        EXPECTED_AUTHOR = workflowOwner;
        EXPECTED_WORKFLOW_NAME = workflowName;
        ADMIN = admin;
    }

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

    function updateMarketsDirect(MarketInfo[] calldata incoming) external {
        if (msg.sender != ADMIN) revert Unauthorized();
        _storeMarkets(incoming);
    }

    function getMarket(bytes32 conditionId) external view returns (MarketInfo memory) {
        return markets[conditionId];
    }

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

    function totalMarkets() external view returns (uint256) {
        return conditionIds.length;
    }

    function supportsInterfort(bytes,bytes) => 0x2a7dba02
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
