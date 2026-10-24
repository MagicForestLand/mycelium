// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Limit Break Creator Token interface; independent of a marketplace or validator address.
/// @dev Interface ABI: https://github.com/limitbreakinc/creator-token-standards/blob/main/src/interfaces/ICreatorToken.sol
interface ICreatorToken {
    event TransferValidatorUpdated(address oldValidator, address newValidator);
    function getTransferValidator() external view returns (address validator);
    function setTransferValidator(address validator) external;
    function getTransferValidationFunction() external view returns (bytes4 functionSignature, bool isViewFunction);
}

interface ITransferValidator {
    function validateTransfer(address caller, address from, address to, uint256 tokenId) external view;
}

interface ITransferValidatorSetTokenType {
    function setTokenTypeOfCollection(address collection, uint16 tokenType) external;
}
