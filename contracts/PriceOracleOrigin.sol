// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title PriceOracleOrigin
/// @notice Emits asset price updates on Base Sepolia (origin chain) for Reactive Guard to monitor.
contract PriceOracleOrigin {
    address public owner;
    mapping(address => uint256) public prices;

    event PriceUpdated(address indexed asset, uint256 price, uint256 timestamp);

    constructor() {
        owner = msg.sender;
    }

    function updatePrice(address asset, uint256 price) external {
        require(msg.sender == owner, "Only owner");
        require(asset != address(0), "Invalid asset");
        require(price > 0, "Invalid price");
        prices[asset] = price;
        emit PriceUpdated(asset, price, block.timestamp);
    }
}
