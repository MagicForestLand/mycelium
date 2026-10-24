// SPDX-License-Identifier: MIT

/*
          __.....__
       .'"         "`.
      .'               `.
     .                   .
    .       __.....__       .
   . _.--"""       """--._ .
  :"                     ";
  `-.__   :         :   __.-'
       """:  ^   ^  :"""
         J   \___/   L
         :           :
         \           /
          `.\_______/.'

        MYCELIUM FRIENDS
        BY MAGIC FOREST
*/

pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ICreatorToken, ITransferValidator, ITransferValidatorSetTokenType} from "./ICreatorToken.sol";
import {GenotypeDescriptor} from "./GenotypeDescriptor.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {PhenotypeRenderer} from "./PhenotypeRenderer.sol";
import {MintSettlement} from "./MintSettlement.sol";
import {MintPricing} from "./MintPricing.sol";
import {GenomeSchema} from "./generated/GenomeSchema.sol";

/// @notice Choose six genotype traits and mint their unique, fully on-chain Mycelium Friend.
/// @dev Owner configures lifetime allowlist quotas, explicitly opens the always-free allowlist phase, then irreversibly
/// enters the public phase. Public primary minting can be paused/resumed without reopening allowlist.
/// Primary treasury, public pricing, sale cap and birth art are immutable. No NFT upgrades or burn.
contract MyceliumFriends is ERC721, IERC2981, ICreatorToken, Ownable2Step, ReentrancyGuard, MintSettlement {
    error InvalidGenotypeDescriptor();
    error InvalidConfiguration();
    error InvalidRoyaltyBps(uint256 bps);
    error InvalidRoyaltyReceiver(address receiver);
    error InvalidTransferValidator(address validator);
    error InvalidQuantity();
    error PublicSaleNotOpen();
    error InvalidSalePhase();
    error InvalidCommitment();
    error CommitmentActive();
    error CommitmentNotReady();
    error CommitmentExpired();
    event CommitmentSubmitted(address indexed buyer, bytes32 indexed commitment, uint256 timestamp);
    event CommitmentConsumed(address indexed buyer, bytes32 indexed commitment);
    error AllowlistAllocationExceeded();
    error SoldOut();
    error WithdrawalFailed();
    error UnauthorizedRefresh();
    event Minted(address indexed buyer, uint256 indexed firstMintNumber, uint256 quantity, uint256 paid);
    event GenotypeAssigned(uint256 indexed tokenId, uint48 genotype);
    event AllowlistAllocationChanged(address indexed wallet, uint256 allocation);
    event AllowlistSaleOpened();
    event PublicSaleOpened(uint256 allowlistMinted);
    event PublicSalePaused();
    event PublicSaleResumed();
    event Withdrawn(address indexed treasury, uint256 amount);
    event RoyaltyConfigured(address indexed receiver, uint96 bps);
    event PhenotypeSourceChanged(address indexed source);
    event ContractURIUpdated();
    event MetadataUpdate(uint256 tokenId);
    event BatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId);
    error InvalidTrait(uint256 layer, uint256 index);
    error OwnershipRenunciationDisabled();
    error CombinationAlreadyMinted(uint256 tokenId);

    uint256 public constant STEM_COUNT = GenomeSchema.STEM_COUNT;
    uint256 public constant CAP_COUNT = GenomeSchema.CAP_COUNT;
    uint256 public constant TEMPERAMENT_COUNT = GenomeSchema.TEMPERAMENT_COUNT;
    uint256 public constant GLASSES_COUNT = GenomeSchema.GLASSES_COUNT;
    uint256 public constant ACCESSORY_COUNT = GenomeSchema.ACCESSORY_COUNT;
    uint256 public constant HOBBY_COUNT = GenomeSchema.HOBBY_COUNT;
    uint256 public constant MAX_SUPPLY = GenomeSchema.MAX_SUPPLY;

    GenotypeDescriptor public immutable genotypeDescriptor;
    PhenotypeRenderer public immutable phenotypeRenderer;
    address payable public immutable treasury;
    address public royaltyReceiver;
    uint96 public royaltyBps;
    uint96 public constant DEFAULT_ROYALTY_BPS = 500;
    uint96 public constant MAX_ROYALTY_BPS = 500;
    uint96 public constant ROYALTY_DENOMINATOR = 10_000;
    address private _transferValidator;
    uint256 public immutable saleCap;
    uint256 public constant PRICE_STEP = MintPricing.STEP;
    uint256 public constant MAX_BATCH = 32;
    uint256 public totalMinted;
    uint256 public publicMinted;
    uint256 public allowlistMinted;
    enum SalePhase { PAUSED, ALLOWLIST, PUBLIC_ACTIVE, PUBLIC_PAUSED }
    SalePhase public salePhase;
    mapping(address => uint256) public allowlistAllocation;
    mapping(address => uint256) public allowlistClaimed;
    mapping(uint256 => uint256) public ownershipEpoch;
    mapping(uint256 => uint48) private _genotypeOf;
    mapping(uint48 => uint256) public tokenForGenotype;
    address public phenotypeSource;

    bytes32 public constant COMMITMENT_DOMAIN = keccak256("MyceliumFriends.PublicMint.v1");
    uint256 public constant MIN_COMMITMENT_AGE = 60;
    uint256 public constant MAX_COMMITMENT_AGE = 24 hours;
    mapping(address => mapping(bytes32 => uint256)) public commitments;

    constructor(address genotypeDescriptorAddress, address phenotypeRendererAddress, address payable treasuryAddress,
        address initialOwner, uint256 collectionSaleCap, address initialRoyaltyReceiver)
        ERC721("Mycelium Friends", "MYFRIENDS") Ownable(initialOwner)
    {
        if (treasuryAddress == address(0) || treasuryAddress == address(this) || phenotypeRendererAddress.code.length == 0 ||
            collectionSaleCap == 0 || collectionSaleCap > MAX_SUPPLY) revert InvalidConfiguration();
        if (genotypeDescriptorAddress.code.length == 0) revert InvalidGenotypeDescriptor();
        GenotypeDescriptor candidate = GenotypeDescriptor(genotypeDescriptorAddress);
        if (
            candidate.combinations() != MAX_SUPPLY ||
            candidate.traitCounts(0) != STEM_COUNT ||
            candidate.traitCounts(1) != CAP_COUNT ||
            candidate.traitCounts(2) != TEMPERAMENT_COUNT ||
            candidate.traitCounts(3) != GLASSES_COUNT ||
            candidate.traitCounts(4) != ACCESSORY_COUNT ||
            candidate.traitCounts(5) != HOBBY_COUNT
        ) revert InvalidGenotypeDescriptor();
        genotypeDescriptor = candidate;
        PhenotypeRenderer renderer = PhenotypeRenderer(phenotypeRendererAddress);
        if (address(renderer.genotypeDescriptor()) != genotypeDescriptorAddress) revert InvalidConfiguration();
        phenotypeRenderer = renderer;
        treasury = treasuryAddress;
        _setRoyaltyInfo(initialRoyaltyReceiver, DEFAULT_ROYALTY_BPS);
        emit TransferValidatorUpdated(address(0), address(0));
        saleCap = collectionSaleCap;
    }

    /// @notice Live supply equals chronological mints because this collection cannot burn.
    function totalSupply() external view returns (uint256) { return totalMinted; }

    function mintPrice(uint256 quantity) public view returns (uint256) {
        if (quantity == 0 || quantity > MAX_BATCH) revert InvalidQuantity();
        if (quantity > saleCap - totalMinted) revert SoldOut();
        bool publicPhase = salePhase == SalePhase.PUBLIC_ACTIVE || salePhase == SalePhase.PUBLIC_PAUSED;
        return publicPhase ? MintPricing.price(publicMinted, quantity) : 0;
    }

    /// @notice Set absolute lifetime allowlist quotas, not additional claims. Zero removes eligibility.
    function setAllowlistAllocations(address[] calldata wallets, uint256[] calldata allocations) external onlyOwner nonReentrant {
        if (salePhase == SalePhase.PUBLIC_ACTIVE || salePhase == SalePhase.PUBLIC_PAUSED) revert InvalidSalePhase();
        if (wallets.length == 0 || wallets.length > 256 || wallets.length != allocations.length) revert InvalidConfiguration();
        for (uint256 i; i < wallets.length; ++i) {
            if (wallets[i] == address(0) || allocations[i] > saleCap) revert InvalidConfiguration();
            allowlistAllocation[wallets[i]] = allocations[i];
            emit AllowlistAllocationChanged(wallets[i], allocations[i]);
        }
    }

    /// @notice Explicitly enable allowlist minting after deployment.
    function startAllowlistSale() external onlyOwner nonReentrant {
        if (salePhase != SalePhase.PAUSED) revert InvalidSalePhase();
        salePhase = SalePhase.ALLOWLIST;
        emit AllowlistSaleOpened();
    }

    /// @notice Irreversible allowlist-to-public transition, performed manually by the owner.
    /// @dev Private claims do not advance public pricing. Public minting starts active.
    function openPublicSale() external onlyOwner nonReentrant {
        if (salePhase != SalePhase.ALLOWLIST) revert InvalidSalePhase();
        salePhase = SalePhase.PUBLIC_ACTIVE;
        emit PublicSaleOpened(allowlistMinted);
    }

    /// @notice Temporarily stop new public commitments and primary mints. Secondary ERC-721 activity is unaffected.
    function pausePublicSale() external onlyOwner nonReentrant {
        if (salePhase != SalePhase.PUBLIC_ACTIVE) revert InvalidSalePhase();
        salePhase = SalePhase.PUBLIC_PAUSED;
        emit PublicSalePaused();
    }

    /// @notice Resume public primary minting without resetting supply, pricing or commitment timestamps.
    function resumePublicSale() external onlyOwner nonReentrant {
        if (salePhase != SalePhase.PUBLIC_PAUSED) revert InvalidSalePhase();
        salePhase = SalePhase.PUBLIC_ACTIVE;
        emit PublicSaleResumed();
    }

    /// @notice Keep late module attachment and validator recovery available; use two-step admin rotation.
    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenunciationDisabled();
    }

    /// @notice Submit a buyer-scoped hash after public opening. No DNA, supply or price reservation.
    function commit(bytes32 commitment) external nonReentrant {
        if (salePhase != SalePhase.PUBLIC_ACTIVE) revert PublicSaleNotOpen();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        uint256 previous = commitments[msg.sender][commitment];
        if (previous != 0 && block.timestamp < previous + MAX_COMMITMENT_AGE) revert CommitmentActive();
        commitments[msg.sender][commitment] = block.timestamp;
        emit CommitmentSubmitted(msg.sender, commitment, block.timestamp);
    }

    /// @notice Reference hash helper. Clients calculate locally to keep selections private before maturity.
    function makeCommitment(address buyer, uint256[6][] calldata selections, bytes32 salt) public view returns (bytes32) {
        if (buyer == address(0) || salt == bytes32(0)) revert InvalidCommitment();
        if (selections.length == 0 || selections.length > MAX_BATCH) revert InvalidQuantity();
        return keccak256(abi.encode(COMMITMENT_DOMAIN, block.chainid, address(this), buyer, selections, salt));
    }

    /// @notice One protected public purchase for 1-32 ordered selections. Buyer receives NFTs and excess ETH.
    /// @dev Rolling commitments prevent immediate copying, not priority over other mature commitments.
    function revealMint(uint256[6][] calldata selections, bytes32 salt, uint256 maxTotalPrice, uint256 deadline)
        external payable nonReentrant returns (uint256[] memory ids)
    {
        if (salePhase != SalePhase.PUBLIC_ACTIVE) revert PublicSaleNotOpen();
        bytes32 commitment = makeCommitment(msg.sender, selections, salt);
        uint256 timestamp = commitments[msg.sender][commitment];
        if (timestamp == 0 || block.timestamp < timestamp + MIN_COMMITMENT_AGE) revert CommitmentNotReady();
        if (block.timestamp >= timestamp + MAX_COMMITMENT_AGE) revert CommitmentExpired();
        uint48[] memory genotypes = _validateSelections(selections);
        uint256 actual = mintPrice(selections.length);
        _checkPayment(actual, maxTotalPrice, deadline);
        delete commitments[msg.sender][commitment];
        emit CommitmentConsumed(msg.sender, commitment);
        uint256 first = _recordMint(selections.length, actual);
        ids = _mintSelections(first, genotypes);
        _refundPayment(actual);
    }

    /// @notice Always-free allowlist mint, available only before public opening.
    function mint(uint256 stem, uint256 cap, uint256 temperament, uint256 glasses, uint256 accessory, uint256 hobby)
        external payable nonReentrant returns (uint256 tokenId)
    {
        if (salePhase != SalePhase.ALLOWLIST) revert InvalidSalePhase();
        uint48 genotype = genotypeForTraits(stem, cap, temperament, glasses, accessory, hobby);
        uint256 existing = tokenForGenotype[genotype];
        if (existing != 0) revert CombinationAlreadyMinted(existing);
        tokenId = _settleAllowlistMint(1);
        _assignAndMint(msg.sender, tokenId, genotype);
    }

    function mintBatch(uint256[6][] calldata selections)
        external payable nonReentrant returns (uint256[] memory ids)
    {
        if (salePhase != SalePhase.ALLOWLIST) revert InvalidSalePhase();
        uint48[] memory genotypes = _validateSelections(selections);
        uint256 first = _settleAllowlistMint(selections.length);
        return _mintSelections(first, genotypes);
    }

    function _validateSelections(uint256[6][] calldata selections) private view returns (uint48[] memory genotypes) {
        uint256 quantity = selections.length;
        if (quantity == 0 || quantity > MAX_BATCH) revert InvalidQuantity();
        genotypes = new uint48[](quantity);
        for (uint256 i; i < quantity; ++i) {
            uint256[6] calldata t = selections[i];
            genotypes[i] = genotypeForTraits(t[0], t[1], t[2], t[3], t[4], t[5]);
            uint256 existing = tokenForGenotype[genotypes[i]];
            if (existing != 0) revert CombinationAlreadyMinted(existing);
            for (uint256 j; j < i; ++j) if (genotypes[j] == genotypes[i]) revert CombinationAlreadyMinted(0);
        }
    }

    function _mintSelections(uint256 first, uint48[] memory genotypes) private returns (uint256[] memory ids) {
        ids = new uint256[](genotypes.length);
        for (uint256 i; i < genotypes.length; ++i) {
            ids[i] = first + i;
            _assignAndMint(msg.sender, ids[i], genotypes[i]);
        }
    }

    function _settleAllowlistMint(uint256 quantity) private returns (uint256 first) {
        uint256 required = mintPrice(quantity);
        if (msg.value != required) revert IncorrectPayment(required, msg.value);
        return _recordMint(quantity, required);
    }

    function _recordMint(uint256 quantity, uint256 actual) private returns (uint256 first) {
        if (salePhase == SalePhase.PUBLIC_ACTIVE) {
            publicMinted += quantity;
        } else if (salePhase == SalePhase.ALLOWLIST) {
            uint256 claimed = allowlistClaimed[msg.sender] + quantity;
            if (claimed > allowlistAllocation[msg.sender]) revert AllowlistAllocationExceeded();
            allowlistClaimed[msg.sender] = claimed;
            allowlistMinted += quantity;
        } else {
            revert InvalidSalePhase();
        }
        first = totalMinted + 1;
        totalMinted += quantity;
        emit Minted(msg.sender, first, quantity, actual);
    }

    function _assignAndMint(address buyer, uint256 tokenId, uint48 genotype) private {
        _genotypeOf[tokenId] = genotype;
        tokenForGenotype[genotype] = tokenId;
        emit GenotypeAssigned(tokenId, genotype);
        _safeMint(buyer, tokenId);
    }

    /// @notice Anyone can trigger payment, always to the immutable treasury.
    function withdraw() external nonReentrant {
        uint256 amount = address(this).balance;
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert WithdrawalFailed();
        emit Withdrawn(treasury, amount);
    }

    /// @notice Owner can select a phenotype source, but cannot replace birth art or primary mint policy.
    function setPhenotypeSource(address source) external onlyOwner {
        if (source != address(0) && source.code.length == 0) revert InvalidConfiguration();
        phenotypeSource = source;
        emit PhenotypeSourceChanged(source);
        if (totalMinted != 0) emit BatchMetadataUpdate(1, totalMinted);
    }

    function notifyMetadataUpdate(uint256 tokenId) external {
        address holder = _requireOwned(tokenId);
        if (msg.sender != holder && msg.sender != phenotypeSource) revert UnauthorizedRefresh();
        emit MetadataUpdate(tokenId);
    }

    /// @notice Collection-wide ERC-2981 quote, paid directly to royaltyReceiver by a participating marketplace.
    /// @dev Same currency as salePrice; rounds down. Any token ID is accepted, including unminted IDs.
    ///      The owner can change receiver/rate, but the 5% ceiling is permanent. This quote alone does not enforce payment.
    function royaltyInfo(uint256, uint256 salePrice) public view override returns (address receiver, uint256 royaltyAmount) {
        return (royaltyReceiver, Math.mulDiv(salePrice, royaltyBps, ROYALTY_DENOMINATOR));
    }

    /// @notice Set collection royalties, including restoring a reduced rate up to the immutable 5% ceiling.
    function setRoyaltyInfo(address receiver, uint96 bps) external onlyOwner {
        _setRoyaltyInfo(receiver, bps);
    }

    function _setRoyaltyInfo(address receiver, uint96 bps) private {
        if (bps > MAX_ROYALTY_BPS) revert InvalidRoyaltyBps(bps);
        // The NFT has no general ETH/ERC-20 royalty withdrawal path; never make it the receiver.
        if (receiver == address(0) || receiver == address(this)) revert InvalidRoyaltyReceiver(receiver);
        royaltyReceiver = receiver;
        royaltyBps = bps;
        emit RoyaltyConfigured(receiver, bps);
    }

    function getTransferValidator() public view override returns (address) { return _transferValidator; }

    function getTransferValidationFunction() external pure override returns (bytes4 functionSignature, bool isViewFunction) {
        return (ITransferValidator.validateTransfer.selector, true);
    }

    /// @notice Set a Creator Token validator; zero disables validation. No marketplace is hardcoded.
    /// @dev A validator can block transfers. Standard holder approvals are still required, including for the validator.
    function setTransferValidator(address validator) external override onlyOwner nonReentrant {
        if (validator != address(0) && (validator == address(this) || validator.code.length == 0)) {
            revert InvalidTransferValidator(validator);
        }
        emit TransferValidatorUpdated(_transferValidator, validator);
        _transferValidator = validator;
        if (validator != address(0)) {
            // Optional registration used by Limit Break validators; legacy validators may omit it.
            try ITransferValidatorSetTokenType(validator).setTokenTypeOfCollection(address(this), 721) {} catch {}
        }
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return interfaceId == type(IERC2981).interfaceId || interfaceId == type(ICreatorToken).interfaceId ||
            interfaceId == 0x49064906 || super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address from) {
        from = _ownerOf(tokenId);
        address validator = _transferValidator;
        if (from != address(0) && to != address(0) && validator != address(0)) {
            if (auth != address(0)) _checkAuthorized(from, auth, tokenId);
            // As in Creator Token, validator-initiated transfers are already validated by that validator.
            // This never bypasses ERC-721 ownership/approval checks in super._update.
            if (_msgSender() != validator) ITransferValidator(validator).validateTransfer(_msgSender(), from, to, tokenId);
        }
        from = super._update(to, tokenId, auth);
        ++ownershipEpoch[tokenId]; // Includes mint and self-transfer; updated before receiver callback.
        if (from != address(0) && phenotypeSource != address(0)) emit MetadataUpdate(tokenId);
    }

    /// @notice Packs six zero-based trait indices into the immutable six-byte DNA.
    function genotypeForTraits(uint256 stem, uint256 cap, uint256 temperament, uint256 glasses, uint256 accessory, uint256 hobby)
        public pure returns (uint48)
    {
        if (stem >= STEM_COUNT) revert InvalidTrait(0, stem);
        if (cap >= CAP_COUNT) revert InvalidTrait(1, cap);
        if (temperament >= TEMPERAMENT_COUNT) revert InvalidTrait(2, temperament);
        if (glasses >= GLASSES_COUNT) revert InvalidTrait(3, glasses);
        if (accessory >= ACCESSORY_COUNT) revert InvalidTrait(4, accessory);
        if (hobby >= HOBBY_COUNT) revert InvalidTrait(5, hobby);
        return uint48(stem) | (uint48(cap) << 8) | (uint48(temperament) << 16) |
            (uint48(glasses) << 24) | (uint48(accessory) << 32) | (uint48(hobby) << 40);
    }

    /// @notice Returns the sequential token ID for a minted combination, or zero when available.
    function tokenForTraits(uint256 stem, uint256 cap, uint256 temperament, uint256 glasses, uint256 accessory, uint256 hobby)
        external view returns (uint256)
    {
        return tokenForGenotype[genotypeForTraits(stem, cap, temperament, glasses, accessory, hobby)];
    }

    /// @notice Returns the DNA assigned at mint. Sequential token IDs start at one.
    function genotypeOf(uint256 tokenId) public view returns (uint48) {
        _requireOwned(tokenId);
        return _genotypeOf[tokenId];
    }

    /// @notice Decodes the immutable DNA stored for a minted sequential token ID.
    function traitsForTokenId(uint256 tokenId)
        public view returns (uint8 stem, uint8 cap, uint8 temperament, uint8 glasses, uint8 accessory, uint8 hobby)
    {
        uint48 genotype = genotypeOf(tokenId);
        stem = uint8(genotype);
        cap = uint8(genotype >> 8);
        temperament = uint8(genotype >> 16);
        glasses = uint8(genotype >> 24);
        accessory = uint8(genotype >> 32);
        hobby = uint8(genotype >> 40);
    }

    /// @notice True for an unminted combination. Invalid trait indices revert.
    /// @dev Availability is a snapshot, not a reservation.
    function isAvailable(uint256 stem, uint256 cap, uint256 temperament, uint256 glasses, uint256 accessory, uint256 hobby)
        external view returns (bool)
    {
        return tokenForGenotype[genotypeForTraits(stem, cap, temperament, glasses, accessory, hobby)] == 0;
    }

    function originalSVG(uint256 tokenId) public view returns (string memory) {
        return genotypeDescriptor.renderSVG(genotypeOf(tokenId));
    }

    /// @notice Immutable collection identity, embedded artwork and project story.
    function contractURI() external view returns (string memory) {
        return genotypeDescriptor.encoder().contractURI();
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        uint48 genotype = genotypeOf(tokenId);
        address source = phenotypeSource;
        if (source == address(0)) return genotypeDescriptor.tokenURI(tokenId, genotype);
        return phenotypeRenderer.tokenURI(address(this), tokenId, genotype, source);
    }

}
