// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./interfaces/IReactive.sol";

/// @title ReactiveStopLossGuard
/// @notice Reactive Omni 2.0 Smart Contract (Lasna 5318007) monitoring PositionOpened, PositionCancelled,
///         and PriceUpdated events via SYSTEM (0x8888...8888) and triggering automated stop-loss callbacks
///         via SYSTEM.requestCallbackV_1_0 without any off-chain bots.
contract ReactiveStopLossGuard is AbstractReactive {
    uint64 public constant CALLBACK_GAS_LIMIT = 1_000_000;

    uint256 public constant POSITION_OPENED_TOPIC0 =
        uint256(keccak256("PositionOpened(uint256,address,address,uint256,uint256)"));
    uint256 public constant POSITION_CANCELLED_TOPIC0 =
        uint256(keccak256("PositionCancelled(uint256,address,uint256)"));
    uint256 public constant PRICE_UPDATED_TOPIC0 =
        uint256(keccak256("PriceUpdated(address,uint256,uint256)"));

    address public immutable owner;
    uint256 public immutable originChainId;
    uint256 public immutable destinationChainId;
    address public immutable oracleOrigin;
    address public vaultCallback;

    uint256 public lastReactBlockNumber;
    uint256 public lastOriginTxHash;

    struct GuardOrder {
        address asset;
        uint256 positionId;
        uint256 stopLossPrice;
        bool active;
    }

    uint256[] private activeOrderIds;
    mapping(uint256 => GuardOrder) public orders;

    event VaultConfigured(address indexed vaultCallback);
    event GuardIndexed(uint256 indexed positionId, address indexed asset, uint256 stopLossPrice);
    event GuardCancelled(uint256 indexed positionId);
    event GuardTriggered(uint256 indexed positionId, address indexed asset, uint256 triggerPrice);

    constructor(
        uint256 originChainId_,
        uint256 destinationChainId_,
        address oracleOrigin_
    ) payable {
        owner = msg.sender;
        originChainId = originChainId_;
        destinationChainId = destinationChainId_;
        oracleOrigin = oracleOrigin_;

        SYSTEM.subscribe(
            originChainId_,
            oracleOrigin_,
            PRICE_UPDATED_TOPIC0,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
    }

    /// @notice Wires the destination StopLossVaultCallback address and subscribes to its PositionOpened & PositionCancelled events.
    function setVaultCallback(address vaultCallback_) external {
        require(msg.sender == owner, "Only owner");
        require(vaultCallback == address(0) && vaultCallback_ != address(0), "Invalid vault");
        vaultCallback = vaultCallback_;

        SYSTEM.subscribe(
            originChainId,
            vaultCallback_,
            POSITION_OPENED_TOPIC0,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        SYSTEM.subscribe(
            originChainId,
            vaultCallback_,
            POSITION_CANCELLED_TOPIC0,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE,
            REACTIVE_IGNORE
        );
        emit VaultConfigured(vaultCallback_);
    }

    /// @inheritdoc IReactive
    function react(LogRecord calldata log_) external override onlySystem {
        lastReactBlockNumber = block.number;
        lastOriginTxHash = log_.txHash;

        if (log_.contractAddress == vaultCallback && log_.topic0 == POSITION_OPENED_TOPIC0) {
            uint256 positionId = log_.topic1;
            address asset = address(uint160(log_.topic3));
            (, uint256 stopLossPrice) = abi.decode(log_.data, (uint256, uint256));

            if (!orders[positionId].active) {
                activeOrderIds.push(positionId);
            }
            orders[positionId] = GuardOrder({
                asset: asset,
                positionId: positionId,
                stopLossPrice: stopLossPrice,
                active: true
            });
            emit GuardIndexed(positionId, asset, stopLossPrice);
            return;
        }

        if (log_.contractAddress == vaultCallback && log_.topic0 == POSITION_CANCELLED_TOPIC0) {
            uint256 positionId = log_.topic1;
            orders[positionId].active = false;
            emit GuardCancelled(positionId);
            return;
        }

        if (log_.contractAddress == oracleOrigin && log_.topic0 == PRICE_UPDATED_TOPIC0 && vaultCallback != address(0)) {
            address asset = address(uint160(log_.topic1));
            (uint256 price,) = abi.decode(log_.data, (uint256, uint256));

            uint256 len = activeOrderIds.length;
            for (uint256 i = 0; i < len; ++i) {
                uint256 pid = activeOrderIds[i];
                GuardOrder storage ord = orders[pid];
                if (ord.active && ord.asset == asset && price <= ord.stopLossPrice) {
                    ord.active = false;
                    bytes memory payload = abi.encodeWithSignature(
                        "executeStopLoss(address,uint256,uint256)",
                        address(0),
                        ord.positionId,
                        price
                    );
                    emit GuardTriggered(ord.positionId, asset, price);
                    SYSTEM.requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0({
                        chainId: destinationChainId,
                        recipient: vaultCallback,
                        gasLimit: CALLBACK_GAS_LIMIT,
                        payload: payload
                    }));
                }
            }
        }
    }
}
