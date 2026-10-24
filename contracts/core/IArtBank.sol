// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IArtBank {
    error InvalidTrait();
    function count() external pure returns (uint256);
    function encodedPart(uint8 index) external view returns (bytes memory);
    function part(uint8 index) external view returns (string memory);
    function label(uint8 index) external view returns (string memory);
    function description(uint8 index) external view returns (string memory);
}
