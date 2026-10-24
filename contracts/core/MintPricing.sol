// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library MintPricing {
    uint256 internal constant STEP = 100_000_000_000_000;
    // minted counts PUBLIC mints only; allowlist mints do not advance the curve.
    // Callers bound minted + quantity by saleCap / GenomeSchema.MAX_SUPPLY.
    function price(uint256 minted, uint256 quantity) internal pure returns (uint256) {
        return STEP * (quantity * minted + quantity * (quantity - 1) / 2);
    }
}
