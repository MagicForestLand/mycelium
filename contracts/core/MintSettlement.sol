// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Internal public-mint settlement. Call checks before effects and refund after
/// all NFT callbacks, under the caller's reentrancy guard. Holds no refund debt.
abstract contract MintSettlement {
    error IncorrectPayment(uint256 required, uint256 received);
    error PriceAboveMaximum(uint256 actual, uint256 maximum);
    error MintDeadlineExpired();
    error RefundFailed();
    event MintRefunded(address indexed buyer, uint256 amount);

    function _checkPayment(uint256 actual, uint256 maximum, uint256 deadline) internal view {
        if (block.timestamp > deadline) revert MintDeadlineExpired();
        if (msg.value != maximum) revert IncorrectPayment(maximum, msg.value);
        if (actual > maximum) revert PriceAboveMaximum(actual, maximum);
    }

    function _refundPayment(uint256 actual) internal {
        uint256 excess = msg.value - actual;
        if (excess == 0) return;
        (bool ok,) = payable(msg.sender).call{value: excess}("");
        if (!ok) revert RefundFailed();
        emit MintRefunded(msg.sender, excess);
    }
}
