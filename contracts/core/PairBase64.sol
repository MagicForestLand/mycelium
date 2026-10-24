// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Standard padded RFC 4648 Base64, optimized for large SVG/JSON inputs.
/// @dev Builds an 8 KiB lookup table in memory, never in contract storage/code.
/// Each 12-bit lookup emits two characters; a loop writes 8 output bytes at once.
library PairBase64 {
    function encode(bytes memory data) internal pure returns (string memory) {
        if (data.length == 0) return "";
        bytes memory table = new bytes(8192);
        uint256 length = 4 * ((data.length + 2) / 3);
        // Reserve a trailing word for overlapping word writes and clean padding.
        bytes memory result = new bytes(length + 32);
        assembly ("memory-safe") {
            // A row contains (first character, each of the 64 second characters).
            // Four word stores build its 64 pairs without an inner loop.
            let alphabet := mload(0x40)
            mstore(alphabet, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef")
            mstore(add(alphabet, 32), "ghijklmnopqrstuvwxyz0123456789+/")
            let row := add(table, 32)
            for { let i := 0 } lt(i, 64) { i := add(i, 1) } {
                let first := mul(byte(0, mload(add(alphabet, i))),
                    0x0100010001000100010001000100010001000100010001000100010001000100)
                mstore(row, or(first, 0x004100420043004400450046004700480049004a004b004c004d004e004f0050))
                mstore(add(row, 32), or(first, 0x005100520053005400550056005700580059005a006100620063006400650066))
                mstore(add(row, 64), or(first, 0x006700680069006a006b006c006d006e006f0070007100720073007400750076))
                mstore(add(row, 96), or(first, 0x007700780079007a0030003100320033003400350036003700380039002b002f))
                row := add(row, 128)
            }

            // Lookup loads end with the selected pair in their low two bytes.
            function encodeSix(input, lookup) -> output {
                output := or(
                    or(shl(48, and(mload(add(lookup, shl(1, and(shr(244, input), 4095)))), 65535)),
                       shl(32, and(mload(add(lookup, shl(1, and(shr(232, input), 4095)))), 65535))),
                    or(shl(16, and(mload(add(lookup, shl(1, and(shr(220, input), 4095)))), 65535)),
                               and(mload(add(lookup, shl(1, and(shr(208, input), 4095)))), 65535))
                )
            }
            let lookup := add(table, 2)
            let input := add(data, 32)
            let fullEnd := add(input, mul(div(mload(data), 6), 6))
            let out := add(result, 32)
            for {} lt(input, fullEnd) { input := add(input, 6) } {
                mstore(out, shl(192, encodeSix(mload(input), lookup)))
                out := add(out, 8)
            }
            let remaining := mod(mload(data), 6)
            if remaining {
                // Ignore dirty bytes after the input without modifying its memory.
                let mask := not(sub(shl(mul(8, sub(32, remaining)), 1), 1))
                mstore(out, shl(192, encodeSix(and(mload(input), mask), lookup)))
            }
            let end := add(add(result, 32), length)
            switch mod(mload(data), 3)
            case 1 { mstore8(sub(end, 2), 61) mstore8(sub(end, 1), 61) }
            case 2 { mstore8(sub(end, 1), 61) }
            mstore(end, 0)
            mstore(result, length)
        }
        return string(result);
    }
}
