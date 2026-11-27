// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Official Reactive Omni 2.0 Interfaces & Base Contracts
/// @notice Mirrors Reactive-Network/reactive-lib-omni (SYSTEM = 0x8888...8888).
interface IPayable {
    receive() external payable;
    function debt(address contract_) external view returns (uint256 debt_);
}

interface IPayer {
    function pay(uint256 amount_) external;
    receive() external payable;
}

interface ISubscriptionService {
    function subscribe(
        uint256 chainId_,
        address contract_,
        uint256 topic0_,
        uint256 topic1_,
        uint256 topic2_,
        uint256 topic3_
    ) external;

    function unsubscribe(
        uint256 chainId_,
        address contract_,
        uint256 topic0_,
        uint256 topic1_,
        uint256 topic2_,
        uint256 topic3_
    ) external;
}

interface ISystemContract is IPayable, ISubscriptionService {
    enum CallbackVersion { V_1_0 }

    struct CallbackConfiguration_V_1_0 {
        uint256 chainId;
        address recipient;
        uint64 gasLimit;
        bytes payload;
    }

    function requestCallback(CallbackVersion version_, bytes memory config_) external;
    function requestCallbackV_1_0(CallbackConfiguration_V_1_0 memory config_) external;
}

interface IReactive is IPayer {
    struct LogRecord {
        uint256 chainId;
        address contractAddress;
        uint256 topic0;
        uint256 topic1;
        uint256 topic2;
        uint256 topic3;
        bytes data;
        uint256 blockNumber;
        uint256 opCode;
        uint256 blockHash;
        uint256 txHash;
        uint256 logIndex;
    }

    function react(LogRecord calldata log_) external;
}

abstract contract AbstractPayer is IPayer {
    error NotAuthorized(address caller_, address expected_);
    error InsufficientFunds(uint256 required_, uint256 available_);
    error TransferFailed();

    IPayable public immutable _SERVICE_PROVIDER;

    constructor(IPayable serviceProvider_) {
        _SERVICE_PROVIDER = serviceProvider_;
    }

    receive() virtual external payable {}

    modifier onlyServiceProvider() {
        _onlyServiceProvider();
        _;
    }

    function _onlyServiceProvider() internal view {
        if (msg.sender != address(_SERVICE_PROVIDER)) {
            revert NotAuthorized(msg.sender, address(_SERVICE_PROVIDER));
        }
    }

    function pay(uint256 amount_) external onlyServiceProvider {
        _pay(payable(msg.sender), amount_);
    }

    function _coverDebt() internal {
        uint256 amount = _SERVICE_PROVIDER.debt(address(this));
        _pay(payable(_SERVICE_PROVIDER), amount);
    }

    function _pay(address payable recipient_, uint256 amount_) internal {
        if (address(this).balance < amount_) {
            revert InsufficientFunds(amount_, address(this).balance);
        }
        if (amount_ > 0) {
            (bool success,) = recipient_.call{ value: amount_ }(new bytes(0));
            if (!success) revert TransferFailed();
        }
    }
}

abstract contract AbstractReactive is AbstractPayer, IReactive {
    ISystemContract internal constant SYSTEM =
        ISystemContract(payable(0x8888888888888888888888888888888888888888));

    uint256 internal constant REACTIVE_IGNORE =
        0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;

    constructor() AbstractPayer(SYSTEM) {}

    modifier onlySystem() {
        _onlyServiceProvider();
        _;
    }
}

abstract contract AbstractCallback is AbstractPayer {
    error CallbackNotAuthorized(address sender_, address expectedSender_);

    address public immutable _CALLBACK_SENDER;

    constructor(IPayable callbackProxy_, address callbackSender_) AbstractPayer(callbackProxy_) {
        _CALLBACK_SENDER = callbackSender_;
    }

    modifier onlyCallbackSender(address callbackSender_) {
        _onlyCallbackSender(callbackSender_);
        _;
    }

    function _onlyCallbackSender(address callbackSender_) internal view {
        if (callbackSender_ != _CALLBACK_SENDER) {
            revert CallbackNotAuthorized(callbackSender_, _CALLBACK_SENDER);
        }
    }
}
