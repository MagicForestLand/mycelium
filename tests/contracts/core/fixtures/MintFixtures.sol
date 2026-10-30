// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MyceliumFriends} from "../../../../contracts/core/MyceliumFriends.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

/// @dev Test-only exhaustive verification, split into bounded eth_call batches.
contract CombinationAssertions {
    function verifyRange(MyceliumFriends token, uint256 start, uint256 end) external view {
        require(start < end && end <= token.MAX_SUPPLY(), "Invalid test range");
        for (uint256 index = start; index < end; ++index) {
            uint48 genotype = token.genotypeDescriptor().genotypeForIndex(index);
            uint8 stem = uint8(genotype);
            uint8 cap = uint8(genotype >> 8);
            uint8 temperament = uint8(genotype >> 16);
            uint8 glasses = uint8(genotype >> 24);
            uint8 accessory = uint8(genotype >> 32);
            uint8 hobby = uint8(genotype >> 40);
            require(stem < token.STEM_COUNT() && cap < token.CAP_COUNT() && temperament < token.TEMPERAMENT_COUNT() && glasses < token.GLASSES_COUNT() && accessory < token.ACCESSORY_COUNT() && hobby < token.HOBBY_COUNT(), "Invalid decoded trait");
            require(token.genotypeForTraits(stem, cap, temperament, glasses, accessory, hobby) == genotype, "DNA round trip");
        }
    }
}

contract MintReceiver is IERC721Receiver {
    enum Mode { Accept, Reject, WrongSelector, ReenterSame }
    error Rejected();
    MyceliumFriends public immutable token;
    Mode public mode;
    bool public duplicateBlocked;
    uint256 public observedSupply;

    constructor(MyceliumFriends token_) { token = token_; }

    function prepare(bytes32 hash) external { token.commit(hash); }

    function mint(uint256 stem, uint256 cap, uint256 temperament, uint256 glasses, uint256 accessory, uint256 hobby, Mode mode_)
        external payable returns (uint256)
    {
        mode = mode_;
        if (token.salePhase() == MyceliumFriends.SalePhase.ALLOWLIST) return token.mint{value:msg.value}(stem, cap, temperament, glasses, accessory, hobby);
        uint256[6][] memory selections = new uint256[6][](1);
        selections[0] = [stem, cap, temperament, glasses, accessory, hobby];
        return token.revealMint{value:msg.value}(selections, bytes32(uint256(1)), msg.value, type(uint256).max)[0];
    }

    function onERC721Received(address, address, uint256 id, bytes calldata)
        external returns (bytes4)
    {
        require(msg.sender == address(token), "Unexpected collection");
        require(token.ownerOf(id) == address(this), "Ownership not updated");
        observedSupply = token.totalSupply();
        if (mode == Mode.Reject) revert Rejected();
        if (mode == Mode.WrongSelector) return bytes4(0);
        if (mode == Mode.ReenterSame) {
            (uint8 stem, uint8 cap, uint8 temperament, uint8 glasses, uint8 accessory, uint8 hobby) = token.traitsForTokenId(id);
            try token.mint(stem, cap, temperament, glasses, accessory, hobby) {
                revert("Duplicate reentrancy succeeded");
            } catch (bytes memory reason) {
                require(bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")), "Wrong revert");
                duplicateBlocked = true;
            }
        }
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract NonReceiver {
    function prepare(MyceliumFriends token, bytes32 hash) external { token.commit(hash); }
    function mint(MyceliumFriends token, uint256 stem, uint256 cap, uint256 temperament, uint256 glasses, uint256 accessory, uint256 hobby) external payable {
        uint256[6][] memory selections = new uint256[6][](1);
        selections[0] = [stem, cap, temperament, glasses, accessory, hobby];
        token.revealMint{value:msg.value}(selections, bytes32(uint256(1)), msg.value, type(uint256).max);
    }
}

contract GenotypeCountsMock {
    uint16[6] public traitCounts;
    uint256 public immutable combinations;
    constructor(uint16[6] memory counts, uint256 total) {
        traitCounts = counts;
        combinations = total;
    }
}
