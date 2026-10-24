// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @dev Fixed SVG grammar for a small optional UTF-8 message; no user markup.
library BubbleText {
    uint256 internal constant MAX_BYTES = 192;

    function valid(bytes memory text) internal pure returns (bool) {
        if (text.length > MAX_BYTES) return false;
        uint256 lines = 1;
        uint256 columns;
        for (uint256 i; i < text.length;) {
            uint256 first = uint8(text[i++]);
            if (first == 10) {
                if (++lines > 3) return false;
                columns = 0;
                continue;
            }
            if (first < 32 || first == 127 || ++columns > 24) return false;
            if (first < 128) continue;
            uint256 extra;
            uint256 codepoint;
            uint256 minimum;
            if (first >= 194 && first <= 223) { extra = 1; codepoint = first & 31; minimum = 128; }
            else if (first >= 224 && first <= 239) { extra = 2; codepoint = first & 15; minimum = 2048; }
            else if (first >= 240 && first <= 244) { extra = 3; codepoint = first & 7; minimum = 65536; }
            else return false;
            if (i + extra > text.length) return false;
            for (uint256 j; j < extra; ++j) {
                uint256 next = uint8(text[i++]);
                if (next < 128 || next > 191) return false;
                codepoint = (codepoint << 6) | (next & 63);
            }
            if (codepoint < minimum || codepoint > 0x10ffff ||
                (codepoint >= 0xd800 && codepoint <= 0xdfff) || (codepoint & 0xffff) >= 0xfffe) return false;
        }
        return true;
    }

    function render(bytes memory text, uint8 x, uint8 y) internal pure returns (string memory) {
        if (text.length == 0) return "";
        bytes memory lines;
        bytes memory line;
        uint256 row;
        uint256 columns;
        for (uint256 i; i <= text.length; ++i) {
            if (i == text.length || text[i] == 0x0a) {
                // Bound the rendered line width even for wide Unicode glyphs.
                lines = abi.encodePacked(lines, '<tspan x="10" y="', Strings.toString(20 + row * 16),
                    '" textLength="', Strings.toString(columns * 7), '" lengthAdjust="spacingAndGlyphs">', line, '</tspan>');
                line = "";
                columns = 0;
                ++row;
            } else {
                bytes1 c = text[i];
                if (uint8(c) < 128 || uint8(c) >= 192) ++columns;
                if (c == 0x26) line = abi.encodePacked(line, "&amp;");
                else if (c == 0x3c) line = abi.encodePacked(line, "&lt;");
                else if (c == 0x3e) line = abi.encodePacked(line, "&gt;");
                else if (c == 0x22) line = abi.encodePacked(line, "&quot;");
                else if (c == 0x27) line = abi.encodePacked(line, "&apos;");
                else line = abi.encodePacked(line, c);
            }
        }
        return string(abi.encodePacked('<g transform="translate(', Strings.toString(uint256(x) * 5), ' ',
            Strings.toString(uint256(y) * 5), ')"><path fill="#fff" stroke="#222" d="M8 1h184q7 0 7 7v48q0 7-7 7H48L24 78l8-15H8q-7 0-7-7V8q0-7 7-7z"/>',
            '<text fill="#222" font-family="monospace" font-size="12">', lines, '</text></g>'));
    }
}
