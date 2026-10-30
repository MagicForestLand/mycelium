# Mint lifecycle and API

Choose the artwork before minting. An eligible wallet can claim during the free
allowlist phase; public purchases use a commitment followed by a mint transaction.
This guide explains the phases, pricing, recovery and contract API. For the trust
model, see [core architecture](ARCHITECTURE.md); operators should start with the
[deployment guide](../operations/DEPLOYMENT.md).

Mycelium Friends is a non-upgradeable ERC-721 (`Mycelium Friends`, `MYFRIENDS`;
Solidity contract `MyceliumFriends`) with six immutable birth traits and an
optional bounded appearance overlay. The verified Ethereum mainnet deployment is
recorded in the [deployment record](../../../../deployments/core/ethereum/mainnet.json).
The collection is
[`0x49f3A83a8EE0B1BB4334c5Fa997565926234648F`](https://etherscan.io/address/0x49f3A83a8EE0B1BB4334c5Fa997565926234648F#code).
Deployment began `PAUSED`; read `salePhase()` for current status.

## Purchase at a glance

| Phase | Who can mint | Price and transaction flow |
| --- | --- | --- |
| `PAUSED` | Nobody | Initial state before allowlist activation |
| `ALLOWLIST` | Wallets with unused lifetime quota | Zero mint price; one mint transaction plus network gas |
| `PUBLIC_ACTIVE` | Any wallet, subject to supply and genotype availability | Commit, wait at least 60 seconds, then reveal and mint at the reviewed price cap |
| `PUBLIC_PAUSED` | Nobody | Public commitments and mints are paused; existing commitments continue to age |

The allowlist-to-public transition is irreversible. Public minting can then be
paused and resumed. There is no route back to the allowlist and no separate
allowlist pause function. Transfers are independent of sale phase.

## Catalog and identity

The current counts are generated in `contracts/core/generated/GenomeSchema.sol`;
the matching JS helpers are in `collection/source/token-id.js`. Do not hardcode
counts in integration code. The tuple order is **stem, cap, temperament, glasses,
accessory, hobby**, with zero-based indices. Index zero in the optional layers
means no glasses (**Clear View**), no accessory (**As You Are**) and no hobby
item (**No Plans**).

```text
genotypeIndex = stem + S * (cap + C * (temperament + T * (glasses + G * (accessory + A * hobby))))
GENOTYPE_SPACE = S * C * T * G * A * H
```

All valid combinations are allowed. The formula above is an offline catalog index, starting at zero. ERC-721 token IDs are sequential mint numbers starting at one, across both sale phases. The six-byte genotype is stored at mint and cannot be inferred from the NFT ID. Changing the pre-deployment catalog can change genotype indices and artwork. After deployment the compiled catalog, bank contents and address graph are permanent. Global identity is `(chainId, collectionAddress, tokenId)`.

## Constructor

```solidity
constructor(
    address genotypeDescriptorAddress,
    address phenotypeRendererAddress,
    address payable treasuryAddress,
    address initialOwner,
    uint256 collectionSaleCap,
    address initialRoyaltyReceiver
)
```

Descriptor, compositor, primary treasury and cap are fixed. `1 <= collectionSaleCap <= MAX_SUPPLY`; it counts both allowlist and public mints. Deployment starts fully paused with an empty allowlist. Owner configures lifetime quotas, explicitly calls `startAllowlistSale()`, then calls `openPublicSale()` to make the irreversible transition to public sale. Public mint can subsequently be paused/resumed without reopening allowlist or resetting price, counters or commitments. There is no timer, admin mint, reserved inventory or public price override. Treasury cannot be zero. The `initialOwner` parameter initializes the collection owner, who also manages sale transitions, capped royalties and optional transfer validation; choose that address with this expanded authority in mind.

Royalties start at 500 bps (5%). `MAX_ROYALTY_BPS = 500` permanently caps every update. Owner may set any rate from 0 to 500, including restoring a reduced rate, and change `royaltyReceiver`. The initial receiver is explicit and independent of treasury; zero and the NFT itself are rejected. The standard Creator Token validator starts disabled and can be configured by owner. See [ROYALTIES.md](ROYALTIES.md) for the Normies comparison, validator trust model and marketplace limitations.

## API

| Function | Behavior |
|---|---|
| `mint(s,c,t,g,a,h)` | Allowlist phase only; always free; safe mint to caller |
| `mintBatch(uint256[6][] selections)` | Allowlist phase only; always-free atomic batch of 1–32 combinations |
| `commit(bytes32 hash)` | Public only; buyer-scoped timestamp; no deposit or reservation |
| `makeCommitment(buyer,selections,salt)` | Reference ABI hash helper; calculate locally before maturity |
| `revealMint(selections,salt,maxTotalPrice,deadline)` | Public only; mature commitment; 1–32 NFTs; actual price capped and excess refunded atomically |
| `commitments(buyer,hash)` | Timestamp, or zero when absent/consumed |
| `mintPrice(q)` | Zero before public phase; otherwise sum of public prices; invalid q/sold out revert; does not check caller eligibility or active/paused status |
| `salePhase()` / `publicMinted()` / `allowlistMinted()` | Explicit lifecycle plus independent counters; phase `PUBLIC_PAUSED` preserves the public pricing position |
| `allowlistAllocation(wallet)` / `allowlistClaimed(wallet)` | Lifetime quota and consumed allowlist claims, unaffected by token transfers |
| `setAllowlistAllocations(wallets, allocations)` | Owner only before public opening; 1–256 entries per call, absolute quotas, zero revokes |
| `startAllowlistSale()` | Owner only, once from initial `PAUSED`; first operation that enables primary minting |
| `openPublicSale()` | Owner only from `ALLOWLIST`, once; irreversible end of allowlist eligibility and start of the public curve |
| `pausePublicSale()` / `resumePublicSale()` | Owner-only public mint pause/resume; preserves pricing, counters and commitments |
| `totalMinted()` | Monotonic primary mint counter |
| `totalSupply()` | Same counter: collection has no burn |
| `MAX_SUPPLY()` | Generated genotype space |
| `saleCap()` | Immutable commercial limit |
| `genotypeOf(tokenId)` / `traitsForTokenId(tokenId)` | Stored six-byte identity for an existing sequential token ID |
| `tokenForTraits(s,c,t,g,a,h)` | Sequential token ID for a minted combination, or zero if still available |
| `royaltyInfo(id, salePrice)` | ERC-2981: current receiver and floor(salePrice × royaltyBps / 10,000), in the sale currency |
| `royaltyBps()` / `royaltyReceiver()` | Current collection rate / recipient |
| `DEFAULT_ROYALTY_BPS()` / `MAX_ROYALTY_BPS()` | Both permanently 500 (5%) |
| `setRoyaltyInfo(receiver, bps)` | Owner only; nonzero/non-self receiver, rate 0–500 inclusive; emits `RoyaltyConfigured` |
| `getTransferValidator()` / `setTransferValidator(address)` | Creator Token validator getter / owner setter; zero disables it |
| `getTransferValidationFunction()` | Standard `validateTransfer(address,address,address,uint256)` selector and `true` for STATICCALL |
| `genotypeForTraits(...)` | Packs six validated indices into uint48; does not prove minting |
| `isAvailable(...)` | Combination availability snapshot; not a reservation or sale-open check |
| `originalSVG(id)` | Original artwork from immutable Descriptor; requires minted NFT |
| `tokenURI(id)` | Original or bounded composed on-chain SVG/JSON |
| `ownershipEpoch(id)` | Zero before mint, then increases on every successful Transfer, including self-transfer |
| `withdraw()` | Anyone may trigger; all ETH goes only to fixed treasury |
| `setPhenotypeSource(address)` | Collection owner only; zero disables source; cannot replace birth identity |
| `notifyMetadataUpdate(id)` | Current holder or current source emits NFT-address ERC-4906 event |
| `transferOwnership` / `acceptOwnership` | Two-step transfer of all collection administration: sale phases, quotas, phenotype, royalties and validator |

Standard ERC-721 transfers/approvals, ERC-165, ERC-4906, ERC-2981 and Creator Token
discovery are supported. ERC-721 Enumerable is not implemented. ERC-2981 reports
royalties; enforcement requires a compatible external protocol and configured
validator. Transfers do not collect fees. An enabled validator can reject
transfers, including self-transfers; minting bypasses validation. Standard
holder authorization is still required when the validator initiates a transfer.

`renounceOwnership()` always reverts so source and validator administration
remain available. Rotate administration through Ownable2Step. A phenotype
source may affect every NFT and cover its displayed image, while `originalSVG`
and birth traits stay immutable.

## Magic Forest allowlist phase

Allowlist mint is available only after explicit activation and before the manual **public** opening. It is permanently free; only network gas is paid. Only the caller's own allowlist entry is checked (no cold-wallet delegation or backend signatures). Both `mint` and `mintBatch` consume the caller's lifetime quota. Reassigning a quota does not reset `allowlistClaimed`; transferring NFTs away does not replenish it. A quota is eligibility, not reserved inventory: all buyers share `saleCap` and unique trait combinations. Avoid oversubscribing a guaranteed list, and leave capacity for public sale. Allowlist token IDs occupy the same sequential mint history but never advance the public price counter.

Prepare owner calls without a signer/private key. Keep the private wallet list
and output outside the repository:

```sh
node tooling/release/prepare-allowlist.mjs /absolute/external/allowlist.json /absolute/external/allowlist-calls.json
```

Input: `chainId`, deployed `collection`, actual `saleCap` and `allowlist`: wallet strings (quota one) or `{ "wallet": "0x...", "allocation": 2 }`. The retired `donors` and `privatePriceETH` fields are rejected. Zero allocation explicitly revokes. The tool rejects duplicates and invalid values, chunks at 100 wallets, refuses to overwrite its output, and keeps both activation calls **separate** from setup transactions. Unlisted existing wallets are not automatically revoked. Read owner, `salePhase`, cap and previous claims, review and sign allocation calls, then separately execute and verify `startAllowlistSale()`. Execute `openPublicSale()` only when the allowlist phase is intentionally complete.

## Protected public pricing

```text
STEP = 100,000,000,000,000 wei = 0.0001 ETH
M = publicMinted before execution (allowlist mints excluded)
Public(M,q) = STEP * (q*M + q*(q-1)/2)
Maximum = currentQuote + STEP * q * bufferMints
Allowlist(q) = 0
```

For example, after ten public mints, a batch of two costs `0.0021 ETH`
(`0.0010 + 0.0011`). A buffer of three additional public mints raises the maximum
payment to `0.0027 ETH`; any unused amount returns in the same transaction.
Network gas is separate from these prices.

Public mint uses one `commit` transaction and one `revealMint` transaction per
batch. The first public single costs zero; a first batch still costs its
arithmetic sum. Send exactly `maxTotalPrice`; the actual execution price must
not exceed it.

The contract retains the actual price, recorded in `Minted.paid`, and returns
any excess once, after all NFT receiver callbacks. Zero excess makes no refund
call. A failed refund or receiver callback reverts the entire batch and restores
the commitment. Contract wallets must accept ETH for buffered purchases.
Allowlist mint requires exact zero payment.

The frontend defaults to Exact (buffer zero), offers 0–10 NFT mints ahead subject to remaining supply, and uses a ten-minute deadline from the reviewed block. A buffer counts NFTs, including other buyers' batches. It is not a reservation or an unlimited approval. No automatic cap increase or retry occurs.

## Commitment and recovery

```text
DOMAIN = keccak256("MyceliumFriends.PublicMint.v1")
H = keccak256(abi.encode(DOMAIN, chainId, collection, buyer, orderedSelections, salt))
ABI types: bytes32,uint256,address,address,uint256[6][],bytes32
```

The 32-byte salt comes from `crypto.getRandomValues`; zero is rejected. Commitments are namespaced by buyer. Reveal requires age >=60 seconds and <24 hours. A live hash cannot reset its timestamp; recommit is allowed at expiry. Successful reveal deletes the entry before callbacks. Buyer, initial recipient and refund recipient are the same caller. Price cap and deadline are signed reveal arguments, outside the commitment, so an explicit retry can review a new price. No token ID, DNA, supply or curve position is reserved. After public opening both direct allowlist selectors revert, even for wallets with remaining quota. Commit is unavailable during allowlist sale, so first public reveals require the initial protection wait.

Rolling commitments block immediate reactive copying, but an original reveal delayed long enough can lose to another newly matured commitment. Earlier commits do not have priority; allowlist-phase sniping remains possible. A failed reveal or simulation exposes the selection. The frontend persists EXPOSED and asks for an explicit price review/retry; a new salt does not restore secrecy for known DNA.

The frontend writes and reads back a versioned local recovery record before the commitment prompt. Private JSON export/import supports another browser/device with the same wallet. No backend, signature encryption or extra signing prompt is used. Losing both local data and backup loses the protection gas, not a mint deposit. Plaintext recovery is sensitive to tooling/extensions with origin access. Pre-maturity reads use general state/history, never targeted availability, genotype or remote commitment calls. Exact reveal simulation begins only after maturity.

Recovery checks canonical receipts, transaction sender/nonce and commitment state. Unknown submission stays blocked until transaction recovery or explicit confirmation that the wallet request was never sent, with unused nonce checks. No elapsed timeout triggers resubmission. Web Locks are required for submission; browsers without them fail closed. Cross-tab stale writes cannot overwrite newer intent data. Normal public purchase has two transaction prompts; wallet connection/network switching and multisig approvals can add wallet-specific steps.

New frontend registrations must carry `mintProtocol: "commit-reveal-v1"` and `saleLifecycle: "phased-v1"`. Older deployments are intentionally unsupported and must not be mixed into the current UI or tests. Constructor argument order/types remain unchanged. Receipt genotype assignments determine actual IDs; quoted IDs are not reservations. Local browser rehearsals use a local channel preview for protected unminted selections, retaining on-chain rendering for minted artwork.

## Website and collection history

The wallet network and configured collection address must be checked before
signing. The frontend connects to the selected deployment in `chain-config.json`.
Local scenario `spiral` creates three real allowlist mints followed by ten real
public mints; empty scenarios are independent collections.

The Spiral represents **all** successful mints in order. Allowlist entries occupy
positions, but only public entries advance `publicMinted` and the public price.
The event reader identifies the phase boundary from
`PublicSaleOpened(allowlistMinted)` and associates each `Minted` transaction with
its ERC-721 `Transfer` logs. Archimedean geometry controls the layout; exact
integer wei controls the linear price.

Compact USD values are approximate CoinGecko quotes, refreshed every five minutes
and hidden after fifteen minutes or a fetch error. They appear beside primary
prices and are neither transaction currency nor a price oracle. Curated
`output/metadata` JSON files are previews, not an authoritative token-ID lookup.

## Local checks

```sh
npm run build
npm test
npm run test:royalties
npm run test:allowlist
npm run test:artwork-lock
npm run test:header
npm run test:catalog
npm run test:core
npm run test:chain
```

`test:royalties` uses a mock descriptor to check royalty arithmetic, the cap, receiver updates, owner permissions, transfer validators and test ETH/ERC-20 settlement without rebuilding output artifacts. `test:core` includes these checks, adversarial Phase-1 behavior and deployment graph verification. `test:chain` includes those checks plus renderer/Base64 differential tests and the complete current art parity suite. One final successful `test:chain` already includes `test:core`. Chain scripts rewrite generated artifacts/reports and use ephemeral Ganache only. They do not send public transactions.

Solidity 0.8.37, legacy optimizer 200 with the Yul pass disabled, viaIR false, Shanghai and OpenZeppelin 5.4.0 are pinned. Keep `package-lock.json`. Runtime size is capped at 24,576 bytes; release preparation also checks full initcode including constructor arguments. Every configured transaction gas limit is capped at 16,777,216. Larger future art catalogs can change the number of generated bank pages.

## Prepare a final release without sending transactions

For every production candidate, [RELEASE.md](../../../repository/release/RELEASE.md) is the canonical source of truth. It defines the strict config, external review, independently approved digest, read-only preflight, deployment boundary, and post-deployment verification workflow.

Production config, candidate manifests, signing intents, raw signed transactions,
journals, address maps and reports belong in an absolute directory outside this
repository. Preparation and preflight do not sign or broadcast. Mainnet uses the
one-transaction offline-signing workflow and never accepts a private key. The
public tooling has no software-key Sepolia CLI. Follow the
[release runbook](../../../repository/release/RELEASE.md) for commands and approvals.

The contract remains fully paused until the owner explicitly starts the allowlist sale. Verify the deployed graph and initial state before configuring access or enabling either sale phase. The canonical art lock and change process are described in [ARTWORK.md](ARTWORK.md).

Frontend setup, local scenarios, wallet integration, cache policy and verified network registration: [web architecture](../../../apps/web/ARCHITECTURE.md).

## Integration constraints

Deployment configs must use `initialOwner`; the obsolete `phenotypeAdmin` key is rejected, including when both keys are present. Migrate explicitly and prepare a new release. Historical deployment manifests remain records of their original deployment and are not rewritten or accepted as fresh release inputs.

Generated metadata keeps its existing ASCII policy. Trait labels/descriptions reject HTML markup characters, quotes, backslashes and controls before compilation; layer names apply the existing JSON-safe ASCII policy. `PROJECT_URL` must be a nonempty ASCII HTTP(S) URL without credentials, whitespace, unsafe JSON characters or malformed percent escapes. Token/collection editorial strings are JSON-escaped at build time; Unicode editorial content remains rejected. Regression tests compile the encoder and parse its returned JSON, including escaped quotes, backslashes and control characters. Current production metadata bytes are unchanged.

Deployment role validation rejects owner/treasury/royalty addresses that collide with any planned collection module and rejects duplicate module addresses. Sharing a wallet between roles is legal and reported explicitly. The NFT constructor also rejects its own address as treasury. Contract wallets, including Safe/multisig, remain supported. A read-only treasury probe uses an explicit amount, pinned block and simulated sender balance; RPCs without state-override support fail closed. It proves only that the current receiving path accepts the tested call, not control of the wallet, future proxy policy or every payment amount. Verify actual withdrawal and wallet control before opening sale; treasury is never replaceable by owner.

Local and fork checks exercise both invocations around the protection wait. Recovery secrets must remain separate from public transaction reports; test success does not authorize a production transaction.
