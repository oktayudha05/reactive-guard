// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IReactive.sol";

/// @title StopLossVaultCallback
/// @notice Destination-chain escrow vault (Ethereum Sepolia / Base Sepolia) using Reactive Omni 2.0 AbstractCallback.
///         Holds user ETH positions and executes automated stop-loss payouts exclusively upon verified callbacks from ReactiveStopLossGuard.
contract StopLossVaultCallback is AbstractCallback {
    struct Position {
        address owner;
        address watchedAsset;
        uint256 amountWei;
        uint256 stopLossPrice;
        bool active;
        bool executed;
    }

    uint256 public nextPositionId;
    mapping(uint256 => Position) public positions;

    event PositionOpened(
        uint256 indexed positionId,
        address indexed owner,
        address indexed watchedAsset,
        uint256 amountWei,
        uint256 stopLossPrice
    );
    event StopLossExecuted(
        uint256 indexed positionId,
        address indexed owner,
        uint256 triggerPrice,
        uint256 payoutWei
    );
    event PositionCancelled(uint256 indexed positionId, address indexed owner, uint256 refundWei);

    constructor(IPayable callbackProxy_, address reactiveGuard_)
        payable
        AbstractCallback(callbackProxy_, reactiveGuard_)
    {}

    /// @notice Deposit ETH protected by an automated on-chain stop-loss threshold.
    function openPosition(address watchedAsset, uint256 stopLossPrice) external payable returns (uint256 positionId) {
        require(msg.value > 0, "Deposit must be > 0");
        require(watchedAsset != address(0), "Invalid asset");
        require(stopLossPrice > 0, "Invalid stop-loss");

        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: msg.sender,
            watchedAsset: watchedAsset,
            amountWei: msg.value,
            stopLossPrice: stopLossPrice,
            active: true,
            executed: false
        });

        emit PositionOpened(positionId, msg.sender, watchedAsset, msg.value, stopLossPrice);
    }

    /// @notice Cancel an active protected position and withdraw deposited ETH.
    function cancelPosition(uint256 positionId) external {
        Position storage pos = positions[positionId];
        require(pos.active && !pos.executed, "Position inactive");
        require(msg.sender == pos.owner, "Only owner");

        uint256 refund = pos.amountWei;
        pos.active = false;
        pos.amountWei = 0;

        (bool ok,) = payable(pos.owner).call{ value: refund }("");
        require(ok, "Refund failed");
        emit PositionCancelled(positionId, pos.owner, refund);
    }

    /// @notice Invoked exclusively by the Reactive Omni 2.0 Callback Proxy on behalf of ReactiveStopLossGuard.
    /// @dev Callback Proxy injects the calling reactive contract's address into reactiveSender_.
    function executeStopLoss(address reactiveSender_, uint256 positionId, uint256 triggerPrice)
        external
        onlyServiceProvider
        onlyCallbackSender(reactiveSender_)
    {
        Position storage pos = positions[positionId];
        require(pos.active && !pos.executed, "Position inactive");
        require(triggerPrice <= pos.stopLossPrice, "Threshold not breached");

        uint256 payout = pos.amountWei;
        pos.active = false;
        pos.executed = true;
        pos.amountWei = 0;

        (bool ok,) = payable(pos.owner).call{ value: payout }("");
        require(ok, "Payout failed");
        emit StopLossExecuted(positionId, pos.owner, triggerPrice, payout);
    }
}
