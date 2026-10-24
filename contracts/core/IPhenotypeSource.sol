// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Optional project-selected appearance adapter. No SVG, JSON or URLs.
/// @dev Runs are [column,row,length,red,green,blue] on the 80x80 grid, painted in order.
/// They may cover birth art and one another, including the entire picture.
/// Message: valid UTF-8, <=192 bytes, <=3 lines of <=24 Unicode scalars each.
/// A 40x16-cell message bubble starts at (bubbleX,bubbleY), constrained to the grid.
/// Empty message means no bubble. Original art/traits never change.
/// Holder/agent permissions belong to the source; bind grants to ownershipEpoch.
/// The collection admin may also select a source affecting every token.
interface IPhenotypeSource {
    function phenotype(address collection, uint256 tokenId, uint48 genotype)
        external view returns (bytes memory runs, string memory message, uint8 bubbleX, uint8 bubbleY);
}
