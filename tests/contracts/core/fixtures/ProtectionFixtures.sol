// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {MyceliumFriends} from "../../../../contracts/core/MyceliumFriends.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract ProtectionWallet is IERC721Receiver {
    MyceliumFriends public immutable token;
    uint256 public mode;
    uint256 public rejectAt;
    uint256 public callbacks;
    uint256 public refunds;
    uint256 public received;
    address public forward;
    constructor(MyceliumFriends nft) { token = nft; }
    function configure(uint256 m, uint256 failAt, address recipient) external {
        mode = m; rejectAt = failAt; callbacks = 0; forward = recipient;
    }
    function execute(bytes calldata data) external payable returns (bytes memory) {
        (bool ok, bytes memory result) = address(token).call{value: msg.value}(data);
        if (!ok) assembly { revert(add(result, 32), mload(result)) }
        return result;
    }
    function probe() private {
        bytes[] memory calls = new bytes[](7);
        uint256[6][] memory selections = new uint256[6][](1);
        address[] memory wallets = new address[](0);
        uint256[] memory allocations = new uint256[](0);
        calls[0] = abi.encodeCall(token.commit, (bytes32(uint256(7))));
        calls[1] = abi.encodeCall(token.revealMint, (selections, bytes32(uint256(1)), 0, type(uint256).max));
        calls[2] = abi.encodeCall(token.mint, (0,0,0,0,0,0));
        calls[3] = abi.encodeCall(token.mintBatch, (selections));
        calls[4] = abi.encodeCall(token.withdraw, ());
        calls[5] = abi.encodeCall(token.setAllowlistAllocations, (wallets, allocations));
        calls[6] = abi.encodeCall(token.openPublicSale, ());
        for (uint256 i; i < calls.length; ++i) {
            (bool ok,) = address(token).call(calls[i]);
            require(!ok, "Callback reentry succeeded");
        }
    }
    receive() external payable {
        require(msg.sender == address(token));
        ++refunds; received += msg.value;
        require(mode != 1, "Reject refund");
        if (mode == 2 || mode == 3) { probe(); require(mode != 3, "Propagate reentry failure"); }
        if (mode == 4) { assembly { for {} 1 {} {} } }
    }
    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(token));
        ++callbacks; require(callbacks != rejectAt, "Reject NFT");
        require(token.ownerOf(tokenId) == address(this));
        if (mode == 2) probe();
        if (forward != address(0)) token.transferFrom(address(this), forward, tokenId);
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract ForcedETH {
    constructor(address payable recipient) payable { selfdestruct(recipient); }
}
