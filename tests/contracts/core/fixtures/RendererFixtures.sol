// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BubbleText} from "../../../../contracts/core/BubbleText.sol";

contract BubbleTextHarness {
    function valid(bytes memory text) external pure returns (bool) { return BubbleText.valid(text); }
}

import {PairBase64} from "../../../../contracts/core/PairBase64.sol";
import {BeadCodec} from "../../../../contracts/core/BeadCodec.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

contract RendererFixtures {
    function encodings(bytes memory data) external pure returns (string memory, string memory) {
        bytes32 beforeHash = keccak256(data);
        string memory optimized = PairBase64.encode(data);
        require(beforeHash == keccak256(data), "Input memory changed");
        string memory referenceEncoding = Base64.encode(data);
        // Allocate and encode again after the first call to exercise memory safety.
        require(keccak256(bytes(PairBase64.encode(data))) == keccak256(bytes(optimized)), "Unstable output");
        return (optimized, referenceEncoding);
    }

    function dirtyPadding(bytes memory data) external pure returns (string memory) {
        // Put nonzero bytes after the input, within an explicitly reserved word.
        bytes memory copy = new bytes(data.length + 32);
        for (uint256 i; i < data.length; ++i) copy[i] = data[i];
        assembly ("memory-safe") {
            mstore(add(add(copy, 32), mload(data)), not(0))
            mstore(copy, mload(data))
        }
        return PairBase64.encode(copy);
    }

    function beadPaths(bytes memory data) external pure returns (string memory) {
        bytes32 beforeHash = keccak256(data);
        string memory svg = BeadCodec.render(data);
        require(beforeHash == keccak256(data), "Input memory changed");
        return string.concat(svg, "|memory-guard|");
    }
}
