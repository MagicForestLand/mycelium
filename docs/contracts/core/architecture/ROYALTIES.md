# Secondary-market royalties and optional transfer validation

Mycelium Friends reports secondary-sale royalties through ERC-2981. The initial
rate is **500 basis points (5%)**, which is also the permanent maximum. Whether
a sale pays that royalty depends on the marketplace and its enforcement policy.

`setRoyaltyInfo(receiver, bps)` is owner-only and allows 0–500 inclusive. A reduced
rate may be restored up to 500. No owner, token-level override or upgrade path
can raise the ERC-2981 rate above 5%.

The constructor takes `initialRoyaltyReceiver`, independently of the immutable primary-mint treasury. Owner may rotate the receiver; zero and the NFT itself are rejected even at a zero rate. Setting both fields is atomic and emits `RoyaltyConfigured(receiver, bps)`, also emitted at deployment. The existing two-step owner role, initialized by the `initialOwner` parameter, manages allowlist quotas and activation, public-sale opening/pause/resume, phenotype, royalties and optional transfer validation. Token holders and a pending owner cannot change these settings.

`royaltyInfo(tokenId, salePrice)` returns `(royaltyReceiver, floor(salePrice * royaltyBps / 10000))`. Any ID is accepted, including unminted IDs, for collection discovery. The quote has no dependence on holder, phenotype, timestamp, caller or currency. OpenZeppelin 5.4.0's `IERC2981` and `Math.mulDiv` supply the standard interface and full-precision arithmetic, including prices up to `uint256.max`. The small direct implementation keeps a single receiver/rate pair with a guarded private setter and no per-token overrides.

A participating marketplace pays the returned amount directly to the receiver
in the sale currency: ETH for ETH sales, the relevant ERC-20 for ERC-20 sales.
Secondary royalties do not enter the NFT or use `withdraw()`. Updating royalties
never changes primary-mint treasury or pricing. The receiver must support the
intended payment methods. This repository contains no production marketplace,
order book, trade executor or payment processor; settlement contracts under
`tests/contracts/core/fixtures/` only exercise integration behavior.

## Standard transfer validator

`ICreatorToken` follows the [Limit Break interface](https://github.com/limitbreakinc/creator-token-standards/blob/main/src/interfaces/ICreatorToken.sol). The token advertises this interface through ERC-165 alongside ERC-721, metadata, ERC-4906 and ERC-2981. It exposes:

- `getTransferValidator()`;
- owner-only `setTransferValidator(address)` with `TransferValidatorUpdated(old, new)`;
- `getTransferValidationFunction()`, returning selector `0xcaee23ea` and `true` for the view function `validateTransfer(address caller, address from, address to, uint256 tokenId)`.

The validator initially equals zero. No chain-specific registry, marketplace address, OpenSea zone or external protocol is embedded in the NFT. Owner can install a contract validator, replace it, or disable it with zero. EOAs and the NFT itself are rejected. Installation attempts optional `setTokenTypeOfCollection(address(this), 721)` registration; unsupported registration is tolerated as in [CreatorTokenBase](https://github.com/limitbreakinc/creator-token-standards/blob/main/src/utils/CreatorTokenBase.sol). A code-bearing address is not proof of correct validation behavior: integration configuration must use a verified, compatible validator.

Every existing-token transfer, including self-transfers and both safe-transfer overloads, consults the enabled validator **before ownership and epoch change**, using STATICCALL. A validator rejection or failure reverts the entire transfer. Mint does not call it. Like Creator Token, a transfer initiated by the validator itself skips the redundant validation call; ERC-721 owner/approval checks still apply. There is no automatic validator approval: moving a holder's NFT always requires the standard authorization from that holder. Ordinary third-party operators receive the exact caller/from/to/tokenId validation.

An enabled validator can block transfers and has its own trust/configuration model. NFT owner can disable a broken validator while retaining ownership. `renounceOwnership()` is disabled so future source attachment and validator recovery remain possible. Administration can be rotated with Ownable2Step; external validator policy still has its own trust model.

## Payment versus enforcement

[ERC-2981](https://eips.ethereum.org/EIPS/eip-2981) reports royalties; it does not universally enforce payment. Transfer validation is the standard integration point for an external enforcement protocol, not a marketplace implementation in the NFT. Enabling a validator alone does not prove enforcement: its policy and the marketplace's settlement/order authorization must also be configured. See the external [Seaport integration documentation](https://docs.opensea.io/docs/creator-fee-enforcement) for one consumer of this generic interface. Mycelium's code does not depend on that consumer.

The 5% ceiling applies to the NFT's ERC-2981 quote, not external marketplace fees or arbitrary behavior of an administrator-selected validator. A validator does not receive sale price through this interface. No implementation here claims guaranteed royalties on every private sale or compatibility with every possible marketplace policy. After deployment, verify the intended chain, actual validator and target protocol with real integration tests; local fixtures do not replace them.

## Historical design reference: Normies

The [official Normies API](https://api.normies.art/) identifies Ethereum collection `0x9Eb6E2025B64f340691e424b7fe7022fFDE12438`. Its published [source](https://eth.blockscout.com/address/0x9Eb6E2025B64f340691e424b7fe7022fFDE12438?tab=contract) / [source API](https://eth.blockscout.com/api/v2/smart-contracts/0x9Eb6E2025B64f340691e424b7fe7022fFDE12438) shows `ERC721C`, `BasicRoyalties`, owner-controlled `setRoyaltyInfo` and a 500-bps constructor default. Its transfer policy uses a configurable validator with optional automatic approval. These are source-level findings; the present deployed royalty rate and validator policy were not measured. Blockscout reported verified, partially verified sources and unchanged bytecode when inspected.

Mycelium adopts ERC-2981, the 5% starting rate, receiver/rate administration and the standard validator integration point. Its additional permanent 5% cap applies to all updates. It retains OpenZeppelin 5.4 ERC-721, two-step ownership, existing epoch semantics, no burn, and no rescue/confiscation path. It omits a default external validator and automatic validator approval, allowing chain/protocol choice at configuration time.

## Validation and release

`npm run test:royalties` checks default/ceiling/discovery, 0–500-bps arithmetic through `uint256.max`, rejected 501+ updates and rollback, receiver validation and rotation, two-step authority, renunciation, test ETH/ERC-20 payouts and payment failure rollback. Validator checks cover registration and its optional fallback, correct arguments and pre-transfer state, rejection on all transfer routes, self-transfers, STATICCALL, approval requirements, replacement/disable and owner transfer/renunciation.

`npm test` validates explicit deployment configuration and argument ordering.
The release config requires `royaltyBps: 500` to acknowledge the contract's
built-in default and an explicit `royaltyReceiver`. The final constructor
argument is the receiver address; older manifests with a rate in that position
are incompatible and cannot be reused. `test:core` / `test:chain` include
royalty/validator checks with the actual catalog and verify the launch quote,
receiver, 5% constants and disabled validator. Configure enforcement only after
initial deployment verification; these local scripts do not deploy or configure
a public contract.
