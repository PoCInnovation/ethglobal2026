// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PolymarketOracle
/// @notice CRE consumer contract that receives Polymarket market data from a Chainlink DON workflow.
///         Implements the IReceiver interface: onReport(bytes metadata, bytes report).
///         The workflow signs a report containing encoded updateMarkets() calldata;
///         this contract verifies the workflow identity and stores the markets on-chain.
contract PolymarketOracle {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    struct MarketInfo {
        bytes32 conditionId; // Polymarket condition ID (unique key)
        string question;     // Market title displayed on Ledger
        uint256 endDate;     // Unix timestamp — market expiry
        bool active;         // Whether the market is still tradable
        uint256 lastUpdate;  // Block timestamp of last CRE update
    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    /// @notice Authorized CRE workflow owner (set at deploy time)
    address public immutable EXPECTED_AUTHOR;

    /// @notice Authorized CRE workflow name (bytes10, left-padded)
    bytes10 public immutable EXPECTED_WORKFLOW_NAME;

    /// @notice Admin address allowed to call updateMarketsDirect (for hackathon / pre-DON)
    address public immutable ADMIN;

    /// @notice conditionId → MarketInfo
    mapping(bytes32 => MarketInfo) public markets;

    /// @notice Ordered list of all known conditionIds (for enumeration)
    bytes32[] public conditionIds;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event MarketsUpdated(uint256 count, uint256 timestamp);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error InvalidAuthor(address received, address expected);
    error InvalidWorkflowName(bytes10 received, bytes10 expected);
    error Unauthorized();

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor(address workflowOwner, bytes10 workflowName, address admin) {
        EXPECTED_AUTHOR = workflowOwner;
        EXPECTED_WORKFLOW_NAME = workflowName;
        ADMIN = admin;
    }

    // -------------------------------------------------------------------------
    // CRE IReceiver interface
    // -------------------------------------------------------------------------

    /// @notice Called by the Chainlink DON forwarder after consensus.
    ///         metadata = abi.encode(workflowOwner, workflowName, ...)
    ///         report   = abi.encodeWithSelector(updateMarkets.selector, markets[])
    function onReport(bytes calldata metadata, bytes calldata report) external {
        // 1. Verify workflow identity from metadata
        (address workflowOwner, bytes10 workflowName) = _decodeMetadata(metadata);

        if (workflowOwner != EXPECTED_AUTHOR) {
            revert InvalidAuthor(workflowOwner, EXPECTED_AUTHOR);
        }
        if (workflowName != EXPECTED_WORKFLOW_NAME) {
            revert InvalidWorkflowName(workflowName, EXPECTED_WORKFLOW_NAME);
        }

        // 2. Decode report: skip 4-byte selector, then ABI-decode the arguments
        //    report = abi.encodeWithSelector(updateMarkets.selector, markets[])
        //    => bytes[4:] = abi.encode(MarketInfo[])
        MarketInfo[] memory incoming = abi.decode(report[4:], (MarketInfo[]));

        // 3. Store markets
        _storeMarkets(incoming);
    }

    // -------------------------------------------------------------------------
    // Admin direct update (hackathon — bypasses DON, admin-only)
    // -------------------------------------------------------------------------

    /// @notice Allows the admin to push market data directly (no DON signature needed).
    ///         In production, this would be removed and only onReport would be used.
    function updateMarketsDirect(MarketInfo[] calldata incoming) external {
        if (msg.sender != ADMIN) revert Unauthorized();
        _storeMarkets(incoming);
    }

    // -------------------------------------------------------------------------
    // Public read helpers
    // -------------------------------------------------------------------------

    /// @notice Returns market info for a given conditionId.
    function getMarket(bytes32 conditionId) external view returns (MarketInfo memory) {
        return markets[conditionId];
    }

    /// @notice Returns all active market conditionIds.
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

    /// @notice Total number of known markets (active + inactive).
    function totalMarkets() external view returns (uint256) {
        return conditionIds.length;
    }

    // -------------------------------------------------------------------------
    // ERC-165 — required by CRE forwarder
    // -------------------------------------------------------------------------

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        // IReceiver: onReport(bytes,bytes) => 0x2a7dba02
        return interfaceId == 0x2a7dba02 || interfaceId == 0x01ffc9a7;
    }

    // -------------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------------

    function _decodeMetadata(
        bytes calldata metadata
    ) internal pure returns (address workflowOwner, bytes10 workflowName) {
        // CRE metadata layout: abi.encode(address workflowOwner, bytes10 workflowName, ...)
        // We only need the first two fields.
        (workflowOwner, workflowName) = abi.decode(metadata, (address, bytes10));
    }

    function _storeMarkets(MarketInfo[] memory incoming) internal {
        for (uint256 i = 0; i < incoming.length; i++) {
            MarketInfo memory m = incoming[i];
            m.lastUpdate = block.timestamp;

            if (markets[m.conditionId].lastUpdate == 0) {
                // New market — register in the index
                conditionIds.push(m.conditionId);
            }

            markets[m.conditionId] = m;
        }

        emit MarketsUpdated(incoming.length, block.timestamp);
    }
}
