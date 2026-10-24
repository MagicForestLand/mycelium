// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PairBase64} from "./PairBase64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {MetadataContent} from "./generated/MetadataContent.sol";

/// @notice Stateless encoder shared by original and optional appearance paths.
contract MetadataEncoder {
    function contractURI() external pure returns (string memory) {
        bytes memory metadata = abi.encodePacked(
            MetadataContent.COLLECTION_PREFIX, PairBase64.encode(bytes(MetadataContent.IMAGE_SVG)),
            '","banner_image":"data:image/svg+xml;base64,',
            PairBase64.encode(bytes(string.concat(MetadataContent.BANNER_OPEN, MetadataContent.IMAGE_SVG, MetadataContent.BANNER_CLOSE))),
            '","external_link":"', MetadataContent.PROJECT_URL, '"}'
        );
        return string.concat("data:application/json;base64,", PairBase64.encode(metadata));
    }

    function tokenURI(uint256 tokenId, string memory svg, bytes memory attributes, bytes memory notes)
        external pure returns (string memory)
    {
        bytes memory metadata = abi.encodePacked(
            '{"name":"Mycelium Friend #', Strings.toString(tokenId),
            '","description":"', MetadataContent.TOKEN_DESCRIPTION, notes,
            '","external_url":"', MetadataContent.PROJECT_URL, '",',
            '"image":"data:image/svg+xml;base64,', PairBase64.encode(bytes(svg)),
            '","attributes":[', attributes, ']}'
        );
        return string.concat("data:application/json;base64,", PairBase64.encode(metadata));
    }
}
