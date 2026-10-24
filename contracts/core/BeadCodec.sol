// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Expands 4-byte bead runs into native SVG paths filled by bead patterns.
/// @dev Each run is [column, row, length, paletteIndex] on an 80x80 grid.
/// Whole cells expose complete circles from the pattern, never clipped beads.
library BeadCodec {
    error InvalidBeadData();

    function render(bytes memory data) internal pure returns (string memory) {
        if (data.length % 4 != 0) revert InvalidBeadData();
        // A path is at most 53 bytes (all five numbers have <= 3 digits).
        // The extra word keeps every literal mstore inside the allocation.
        // Write directly into one buffer: no per-run strings or temporary paths.
        bytes memory result = new bytes(data.length / 4 * 53 + 32);
        assembly ("memory-safe") {
            function decimal(ptr, value) -> next {
                switch lt(value, 10)
                case 1 {
                    mstore8(ptr, add(48, value))
                    next := add(ptr, 1)
                }
                default {
                    if gt(value, 99) {
                        mstore8(ptr, add(48, div(value, 100)))
                        ptr := add(ptr, 1)
                        value := mod(value, 100)
                    }
                    mstore8(ptr, add(48, div(value, 10)))
                    mstore8(add(ptr, 1), add(48, mod(value, 10)))
                    next := add(ptr, 2)
                }
            }
            let out := add(result, 32)
            let end := add(add(data, 32), mload(data))
            for { let input := add(data, 32) } lt(input, end) { input := add(input, 4) } {
                let run := mload(input)
                let x := byte(0, run)
                let y := byte(1, run)
                let count := byte(2, run)
                if or(or(gt(x, 79), gt(y, 79)), or(iszero(count), gt(add(x, count), 80))) {
                    // InvalidBeadData()
                    mstore(0, shl(224, 0xca2c8d2e))
                    revert(0, 4)
                }
                mstore(out, '<path fill="url(#bs-p')
                out := decimal(add(out, 21), byte(3, run))
                mstore(out, ')" d="M')
                out := decimal(add(out, 7), mul(x, 5))
                mstore8(out, 32)
                out := decimal(add(out, 1), mul(y, 5))
                mstore8(out, 104)
                out := decimal(add(out, 1), mul(count, 5))
                mstore(out, 'v5h-')
                out := decimal(add(out, 4), mul(count, 5))
                mstore(out, 'z"/>')
                out := add(out, 4)
            }
            mstore(result, sub(out, add(result, 32)))
        }
        return string(result);
    }
}
