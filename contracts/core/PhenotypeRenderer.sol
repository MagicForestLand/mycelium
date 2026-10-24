// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GenotypeDescriptor} from "./GenotypeDescriptor.sol";
import {IPhenotypeSource} from "./IPhenotypeSource.sol";
import {BubbleText} from "./BubbleText.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice Fixed compositor. Optional layers may cover the picture, never change originalSVG or DNA.
contract PhenotypeRenderer {
    GenotypeDescriptor public immutable genotypeDescriptor;
    uint256 public constant SOURCE_GAS = 2_000_000;
    error InsufficientRenderGas();
    struct Appearance { bytes runs; string message; uint8 x; uint8 y; }
    uint256 public constant MAX_RUNS = 192;
    uint256 public constant MAX_DATA = MAX_RUNS * 6;
    uint256 public constant MAX_OVERLAY_BYTES = 12_288;
    uint256 public constant MAX_SVG_BYTES = 143_360;
    uint256 public constant MAX_URI_BYTES = 262_144;

    constructor(GenotypeDescriptor base) {
        require(address(base).code.length != 0, "Invalid base");
        genotypeDescriptor = base;
    }

    function tokenURI(address collection, uint256 tokenId, uint48 genotype, address source)
        external view returns (string memory)
    {
        return _compose(tokenId, genotype, _read(source, collection, tokenId, genotype));
    }

    function _compose(uint256 tokenId, uint48 genotype, Appearance memory appearance) private view returns (string memory) {
        string memory graphic = _overlay(appearance.runs);
        // A malformed graphic invalidates the entire optional state, including its message.
        if (appearance.runs.length != 0 && bytes(graphic).length == 0) {
            return genotypeDescriptor.tokenURI(tokenId, genotype);
        }
        string memory extra = string.concat(graphic, BubbleText.render(bytes(appearance.message), appearance.x, appearance.y));
        string memory original = genotypeDescriptor.renderSVG(genotype);
        bytes memory attrs = genotypeDescriptor.attributes(genotype);
        bytes memory notes = genotypeDescriptor.fieldNotes(genotype);
        if (bytes(extra).length == 0 || bytes(extra).length > MAX_OVERLAY_BYTES ||
            bytes(original).length + bytes(extra).length > MAX_SVG_BYTES) {
            return genotypeDescriptor.encoder().tokenURI(tokenId, original, attrs, notes);
        }
        string memory svg = _append(original, extra);
        string memory uri = _encode(tokenId, svg, attrs, notes, appearance.message);
        if (bytes(uri).length > MAX_URI_BYTES) return genotypeDescriptor.encoder().tokenURI(tokenId, original, attrs, notes);
        return uri;
    }

    function _append(string memory original, string memory extra) private pure returns (string memory svg) {
        // Insert before the closing </g></svg>; the original bytes are untouched.
        bytes memory prefix = bytes(original);
        uint256 originalLength = prefix.length;
        assembly ("memory-safe") { mstore(prefix, sub(originalLength, 10)) }
        svg = string.concat(string(prefix), extra, "</g></svg>");
        assembly ("memory-safe") { mstore(prefix, originalLength) }
    }

    function _encode(uint256 tokenId, string memory svg, bytes memory attrs, bytes memory notes, string memory text)
        private view returns (string memory)
    {
        if (bytes(text).length != 0) {
            string memory message = Strings.escapeJSON(text);
            attrs = abi.encodePacked(attrs, ',{"trait_type":"Message","value":"', message, '"}');
            notes = abi.encodePacked(notes, "\\n\\nMessage: ", message);
        }
        return genotypeDescriptor.encoder().tokenURI(tokenId, svg, attrs, notes);
    }

    function _read(address source, address collection, uint256 tokenId, uint48 genotype)
        private view returns (Appearance memory appearance)
    {
        if (source.code.length == 0) return appearance;
        // Never silently omit a valid layer just because a reader chose a smaller gas limit.
        // Ensure the source receives its full capped budget (including EIP-150 margin).
        if (gasleft() < SOURCE_GAS + 100_000) revert InsufficientRenderGas();
        bytes memory input = abi.encodeCall(IPhenotypeSource.phenotype, (collection, tokenId, genotype));
        uint256 limit = SOURCE_GAS;
        uint256 size;
        bool ok;
        assembly ("memory-safe") {
            ok := staticcall(limit, source, add(input, 32), mload(input), 0, 0)
            size := returndatasize()
        }
        // Four head words plus two dynamic length words and padded bounded contents.
        if (!ok || size < 192 || size > 192 + MAX_DATA + BubbleText.MAX_BYTES) return appearance;
        bytes memory raw = new bytes(size);
        assembly ("memory-safe") { returndatacopy(add(raw, 32), 0, size) }
        uint256 runsLength = _word(raw, 128);
        if (_word(raw, 0) != 128 || runsLength > MAX_DATA || runsLength % 6 != 0 ||
            _word(raw, 64) > 40 || _word(raw, 96) > 64) return appearance;
        uint256 textOffset = 160 + ((runsLength + 31) / 32) * 32;
        if (_word(raw, 32) != textOffset || size < textOffset + 32) return appearance;
        uint256 textLength = _word(raw, textOffset);
        if (textLength > BubbleText.MAX_BYTES || size != textOffset + 32 + ((textLength + 31) / 32) * 32) return appearance;
        (appearance.runs, appearance.message, appearance.x, appearance.y) = abi.decode(raw, (bytes, string, uint8, uint8));
        if (!BubbleText.valid(bytes(appearance.message))) {
            appearance.runs = "";
            appearance.message = "";
        }
    }

    function _word(bytes memory raw, uint256 offset) private pure returns (uint256 word) {
        assembly ("memory-safe") { word := mload(add(add(raw, 32), offset)) }
    }

    function _overlay(bytes memory runs) private pure returns (string memory) {
        if (runs.length == 0) return "";
        bytes memory output = new bytes(MAX_OVERLAY_BYTES + 32);
        uint256 used;
        for (uint256 i; i < runs.length; i += 6) {
            uint256 x = uint8(runs[i]);
            uint256 y = uint8(runs[i + 1]);
            uint256 count = uint8(runs[i + 2]);
            if (x >= 80 || y >= 80 || count == 0 || x + count > 80) return "";
            uint256 color = (uint256(uint8(runs[i + 3])) << 16) |
                (uint256(uint8(runs[i + 4])) << 8) | uint8(runs[i + 5]);
            bytes memory hexColor = bytes(Strings.toHexString(color, 3));
            bytes memory rgb = new bytes(7);
            rgb[0] = "#";
            for (uint256 j; j < 6; ++j) rgb[j + 1] = hexColor[j + 2];
            bytes memory fragment = abi.encodePacked('<path fill="', rgb,
                '" d="M', Strings.toString(x * 5), ' ', Strings.toString(y * 5),
                'h', Strings.toString(count * 5), 'v5h-', Strings.toString(count * 5), 'z"/>');
            if (used + fragment.length > MAX_OVERLAY_BYTES) return "";
            // Bounded copies into one allocation; no growing-prefix concatenation.
            assembly ("memory-safe") {
                let dst := add(add(output, 32), used)
                let src := add(fragment, 32)
                let end := add(src, mload(fragment))
                for {} lt(src, end) { src := add(src, 32) dst := add(dst, 32) } {
                    mstore(dst, mload(src))
                }
            }
            used += fragment.length;
        }
        assembly ("memory-safe") { mstore(output, used) }
        return string(output);
    }
}
