// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {MintSettlement} from "../../../../contracts/core/MintSettlement.sol";
import {MintPricing} from "../../../../contracts/core/MintPricing.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Test-only entry point. Production has no capped direct mint adapter.
contract SettlementHarness is MintSettlement, ReentrancyGuard {
    uint256 public minted;
    uint256 public revenue;
    function settle(uint256 quantity, uint256 maximum, uint256 deadline) external payable nonReentrant {
        require(quantity > 0 && quantity <= 32);
        uint256 actual = MintPricing.price(minted, quantity);
        _checkPayment(actual, maximum, deadline);
        minted += quantity;
        revenue += actual;
        _refundPayment(actual);
    }
}

contract SettlementWallet {
    SettlementHarness public immutable target;
    uint256 public mode;
    uint256 public refunds;
    uint256 public received;
    constructor(SettlementHarness instance) { target = instance; }
    function run(uint256 q, uint256 maximum, uint256 deadline, uint256 nextMode) external payable {
        mode = nextMode;
        target.settle{value: msg.value}(q, maximum, deadline);
    }
    receive() external payable {
        ++refunds; received += msg.value;
        require(mode != 1, "Reject refund");
        if (mode == 2 || mode == 3) {
            (bool ok, bytes memory reason) = address(target).call(abi.encodeCall(target.settle, (1, 0, type(uint256).max)));
            require(!ok && bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
            require(mode != 3, "Propagate rejection");
        }
        if (mode == 4) { assembly { for {} 1 {} {} } }
    }
}
