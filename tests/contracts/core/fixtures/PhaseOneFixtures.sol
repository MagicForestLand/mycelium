// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MyceliumFriends} from "../../../../contracts/core/MyceliumFriends.sol";
import {MintPricing} from "../../../../contracts/core/MintPricing.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract PriceHarness {
    function quote(uint256 minted, uint256 quantity) external pure returns (uint256) {
        require(quantity > 0 && minted + quantity <= 2**48);
        return MintPricing.price(minted, quantity);
    }
}

contract MetadataCallMeter {
    function measure(MyceliumFriends nft, uint256 id) external view returns (uint256 gasUsed, uint256 uriBytes) {
        uint256 beforeCall = gasleft();
        string memory uri = nft.tokenURI(id);
        gasUsed = beforeCall - gasleft();
        uriBytes = bytes(uri).length;
    }
}

contract TreasuryFixture {
    bool public reject;
    MyceliumFriends public token;
    bool public reentryBlocked;
    function configure(MyceliumFriends nft, bool rejecting) external { token = nft; reject = rejecting; }
    receive() external payable {
        require(!reject, "Reject payment");
        if (address(token) != address(0)) {
            try token.withdraw() { revert("Reentry succeeded"); }
            catch (bytes memory reason) {
                require(bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
                reentryBlocked = true;
            }
        }
    }
}

contract BatchReceiverFixture is IERC721Receiver {
    MyceliumFriends public immutable token;
    uint256 public callbacks;
    uint256 public observedMinted;
    uint256 public observedEpoch;
    bool public reentryBlocked;
    uint256 public rejectAt;
    address public forward;
    constructor(MyceliumFriends nft) { token = nft; }
    function prepare(bytes32 hash) external { token.commit(hash); }
    function run(uint256[6][] calldata selections, uint256 rejectNumber, address recipient) external payable {
        callbacks = 0; rejectAt = rejectNumber; forward = recipient;
        if (token.salePhase() == MyceliumFriends.SalePhase.PUBLIC_ACTIVE) token.revealMint{value: msg.value}(selections, bytes32(uint256(1)), msg.value, type(uint256).max);
        else token.mintBatch{value: msg.value}(selections);
    }
    function onERC721Received(address, address, uint256 tokenId, bytes calldata) external returns (bytes4) {
        require(msg.sender == address(token));
        ++callbacks;
        require(callbacks != rejectAt, "Reject batch");
        observedMinted = token.totalMinted();
        observedEpoch = token.ownershipEpoch(tokenId);
        try token.mint(1, 1, 1, 1, 1, 1) { revert("Nested mint succeeded"); }
        catch (bytes memory reason) {
            require(bytes4(reason) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
            reentryBlocked = true;
        }
        if (forward != address(0)) token.transferFrom(address(this), forward, tokenId);
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract PhenotypeSourceFixture {
    bytes public data;
    string public message;
    uint8 public bubbleX;
    uint8 public bubbleY;
    uint256 public mode;
    uint256 private writes;
    function configure(uint256 nextMode, bytes calldata nextData) external {
        mode = nextMode; data = nextData; message = ""; bubbleX = 0; bubbleY = 0;
    }
    function configureMessage(bytes calldata nextData, string calldata text, uint8 x, uint8 y) external {
        mode = 0; data = nextData; message = text; bubbleX = x; bubbleY = y;
    }
    // Non-view deliberately: STATICCALL must reject mode 5's storage write.
    function phenotype(address, uint256, uint48) external returns (bytes memory, string memory, uint8, uint8) {
        if (mode == 1) revert("Broken phenotype");
        if (mode == 2) { assembly { for {} 1 {} {} } }
        if (mode == 3) { assembly { return(0, 262144) } }
        if (mode == 4) { assembly { mstore(0, 64) mstore(32, 6) return(0, 96) } }
        if (mode == 5) ++writes;
        if (mode == 6) { assembly { mstore(0, 32) mstore(32, not(0)) return(0, 64) } }
        if (mode == 7) { assembly { mstore(0, 32) mstore(32, 6) return(0, 65) } }
        if (mode == 8) { bytes memory raw = data; assembly { return(add(raw, 32), mload(raw)) } }
        return (data, message, bubbleX, bubbleY);
    }
    function refresh(MyceliumFriends nft, uint256 id) external { nft.notifyMetadataUpdate(id); }
}

contract EpochPermissionFixture {
    struct Grant { address owner; address agent; uint256 epoch; }
    mapping(address => mapping(uint256 => Grant)) public grants;
    function grant(MyceliumFriends nft, uint256 id, address agent) external {
        require(nft.ownerOf(id) == msg.sender);
        grants[address(nft)][id] = Grant(msg.sender, agent, nft.ownershipEpoch(id));
    }
    function valid(MyceliumFriends nft, uint256 id, address agent) external view returns (bool) {
        Grant memory g = grants[address(nft)][id];
        return g.agent == agent && nft.ownerOf(id) == g.owner && nft.ownershipEpoch(id) == g.epoch;
    }
}

contract ExternalNFTFixture is ERC721 {
    constructor() ERC721("Official looking clone", "CLONE") {}
    function mint(uint256 id) external { _mint(msg.sender, id); }
}

/// @dev Same-chain owner-only proof of attachment, not production Messaging.
contract MessagingFixture {
    struct NFTRef { uint256 chainId; address collection; uint256 tokenId; }
    mapping(uint256 => mapping(address => bool)) public verified;
    event Message(address indexed fromCollection, uint256 fromId, address indexed toCollection, uint256 toId);
    function verify(uint256 chainId, address collection) external { verified[chainId][collection] = true; }
    function send(NFTRef calldata from, NFTRef calldata to) external {
        require(from.chainId == block.chainid && to.chainId == block.chainid);
        require(verified[from.chainId][from.collection] && verified[to.chainId][to.collection]);
        require(ERC721(from.collection).ownerOf(from.tokenId) == msg.sender);
        require(ERC721(to.collection).ownerOf(to.tokenId) != address(0));
        emit Message(from.collection, from.tokenId, to.collection, to.tokenId);
    }
}

/// @dev Ownership-following wallet mock; not an ERC-6551 implementation.
contract BoundWalletFixture {
    MyceliumFriends public immutable token;
    uint256 public immutable tokenId;
    constructor(MyceliumFriends nft, uint256 id) { token = nft; tokenId = id; }
    receive() external payable {}
    function owner() public view returns (address) { return token.ownerOf(tokenId); }
    function pay(address payable recipient, uint256 amount) external {
        require(msg.sender == owner());
        (bool ok,) = recipient.call{value: amount}(""); require(ok);
    }
}
