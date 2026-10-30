// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {MyceliumFriends} from "../../../../contracts/core/MyceliumFriends.sol";

contract TransferValidatorFixture {
    mapping(address => uint16) public tokenTypes;
    uint256 public mode;
    uint256 private writes;
    address public caller;
    address public from;
    address public to;
    uint256 public tokenId;
    uint256 public epoch;

    function setTokenTypeOfCollection(address collection, uint16 tokenType) external {
        require(msg.sender == collection);
        tokenTypes[collection] = tokenType;
    }

    function configure(uint256 m, address c, address f, address t, uint256 id, uint256 e) external {
        mode = m; caller = c; from = f; to = t; tokenId = id; epoch = e;
    }

    // Deliberately non-view: the NFT must use STATICCALL, making mode 2 fail.
    function validateTransfer(address c, address f, address t, uint256 id) external {
        require(mode != 1, "Blocked transfer");
        if (mode == 2) ++writes;
        require(c == caller && f == from && t == to && id == tokenId, "Wrong validation arguments");
        require(MyceliumFriends(msg.sender).ownerOf(id) == from, "Validation after ownership change");
        require(MyceliumFriends(msg.sender).ownershipEpoch(id) == epoch, "Validation after epoch change");
    }

    function move(MyceliumFriends nft, address f, address t, uint256 id) external { nft.transferFrom(f, t, id); }
}

// Validators without the optional token-type registration function remain supported.
contract LegacyTransferValidatorFixture {
    function validateTransfer(address, address, address, uint256) external pure {}
}

// Test-only settlement models, not production marketplaces or order authorization.
contract RoyaltyCurrencyFixture is ERC20 {
    constructor(address buyer) ERC20("Test Currency", "TEST") { _mint(buyer, 1_000_000); }
}

contract RoyaltyTreasuryFixture {
    bool public rejecting;
    function setRejecting(bool value) external { rejecting = value; }
    receive() external payable { require(!rejecting, "Reject royalty"); }
}

contract RoyaltyMarketFixture {
    function buyETH(address nft, uint256 id) external payable {
        address seller = IERC721(nft).ownerOf(id);
        (address receiver, uint256 royalty) = IERC2981(nft).royaltyInfo(id, msg.value);
        IERC721(nft).safeTransferFrom(seller, msg.sender, id);
        (bool paidRoyalty,) = payable(receiver).call{value: royalty}("");
        require(paidRoyalty, "Royalty payment failed");
        (bool paidSeller,) = payable(seller).call{value: msg.value - royalty}("");
        require(paidSeller, "Seller payment failed");
    }

    function buyERC20(address nft, uint256 id, ERC20 currency, uint256 price) external {
        address seller = IERC721(nft).ownerOf(id);
        (address receiver, uint256 royalty) = IERC2981(nft).royaltyInfo(id, price);
        IERC721(nft).safeTransferFrom(seller, msg.sender, id);
        require(currency.transferFrom(msg.sender, receiver, royalty));
        require(currency.transferFrom(msg.sender, seller, price - royalty));
    }
}
