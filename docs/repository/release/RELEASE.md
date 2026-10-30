# Production release binding, offline signing and deployment

Production uses the `release:prepare`, `release:preflight`, `release:mainnet`, `release:ledger-sign`, `release:verification` and `release:verify` workflow with a format-2 manifest. Preparation, preflight, intent creation and source-bundle creation never sign or broadcast. The mainnet command never accepts a seed or private key: it consumes one externally signed raw transaction at a time, decodes every material field before broadcast, and records recovery evidence outside the repository.

The presence of the mainnet command is not deployment authorization. The selected and pinned Ledger procedure is documented in [LEDGER-SIGNING.md](../../contracts/core/operations/LEDGER-SIGNING.md); it must still be exercised on the actual device with a non-mainnet rehearsal before it may produce a mainnet raw transaction. Never import a Ledger seed into MetaMask, this repository, a shell variable or a software signer.

## Independent approval

Preparation produces a **candidate**, not an approval. A reviewer must independently check the source revision, art lock, roles, deployment nonce, complete constructor plan and fee budget, then approve the exact SHA-256 digest through a trusted channel. Pass that independently received value as `--expected-release`. Reading `manifest.digest` and automatically treating it as the approved value defeats the gate. Editing any bound value, even to another internally consistent configuration, requires new approval.

Production preparation requires a clean git working tree, including untracked files. Keep manifests, deployment config drafts and reports outside the repository, or commit the config before preparation. Output within the source checkout, including through symlinks, is rejected. A new source commit or tree invalidates the previous manifest. This avoids a self-referential commit containing its own release hash. Historical deployment manifests are evidence of earlier releases, not inputs for this workflow.

## Explicit production config

Set all fields below; production permits no omitted fields or unknown keys. `chainId: 1` always requires `kind: "PRODUCTION"`. The same strict profile can be rehearsed on an explicitly chosen test chain using production artwork.

| Field | Required value |
|---|---|
| `kind` | `"PRODUCTION"` |
| `chainId` | Explicit positive integer; Ethereum mainnet is 1 |
| `initialOwner`, `treasury`, `royaltyReceiver` | Explicit nonzero addresses; none may be a planned collection module |
| `royaltyBps` | 500; confirms the constructor's default and permanent ceiling |
| `saleCap` | Explicit integer within the current GenomeSchema supply |
| `deployer` | Expected sender of the sequential CREATE transactions |
| `nonce` | Explicit starting transaction nonce; latest and pending must both match |
| `roleCodeHashes` | Object with exactly `initialOwner`, `treasury`, `royaltyReceiver`: reviewed lowercase `keccak256(eth_getCode(address))` for each role, including the empty-code hash for EOAs |
| `treasuryProbeWei` | Positive decimal integer string; amount used in the simulated receiving call |
| `gasLimits` | Object mapping **every** name from `deploymentPlan(config).steps` to an approved positive decimal gas-limit string |
| `maxFeePerGas`, `maxPriorityFeePerGas` | Explicit decimal wei strings; max fee must cover priority and current base fee |
| `balanceBufferWei` | Explicit nonnegative decimal wei string, including `"0"` if deliberately chosen |

No fixture/test addresses are production defaults. A shared role wallet is allowed and shown in the report. Safes and other contract wallets are allowed. Verify signer control, Safe owners/threshold/modules and treasury receiving policy independently. Code hashes alone do not attest proxy implementations or storage configuration; upgrading a Safe/module or changing wallet policy requires renewed review even if proxy runtime hash is unchanged.

Gas limits are reviewed budgets, not automatically inferred estimates. Obtain them from a deployment rehearsal on the actual target fork. Config validation, preflight and both broadcasters reject any per-transaction gas limit above the EIP-7825 cap of 16,777,216, independently of the block gas limit. Preflight reports `sum(gasLimits) * maxFeePerGas` plus the explicit buffer as the required balance. Actual fees can only be known from receipts; this is not an exact deployment-cost promise.

The exact pinned fork procedure and command are documented in [MAINNET-FORK.md](../../contracts/core/operations/MAINNET-FORK.md). Its runner accepts only a local Anvil endpoint and cannot point deployment transactions at a public RPC.

## Prepare, review, preflight

```sh
npm run release:prepare -- /absolute/external/production.json /absolute/external/release
# Independently review and approve the candidate digest printed above.
RPC_URL=... npm run release:preflight -- /absolute/external/release/manifest.json \
  --expected-release APPROVED_SHA256 \
  --deployer EXPECTED_SIGNER_ADDRESS \
  --report /absolute/external/preflight.json
```

The expected deployer argument is separate from the manifest to catch selection mistakes. This read-only command cannot prove control of that address. When the mainnet owner is a contract, tooling automatically loads the source-bound `tooling/config/mainnet-safe-policy.json`; no additional CLI parameter is needed. Preflight checks proxy and singleton code hashes, version, owners, threshold, nonce, modules, guards and fallback handler at a pinned canonical block. Mainnet signing and broadcasting follow the separate reviewed workflow below.

## Mainnet: one offline-signed transaction at a time

Create the next intent only after preflight and independent digest approval:

```sh
RPC_URL=... npm run release:mainnet -- intent /absolute/external/release/manifest.json \
  --expected-release APPROVED_SHA256 \
  --deployer EXPECTED_SIGNER_ADDRESS \
  --journal /absolute/external/mainnet-journal.json \
  --intent /absolute/external/next-intent.json
```

The intent contains the exact unsigned type-2 transaction and hash. Compare its
chain, sender, nonce, fee caps and unsigned hash with the approved manifest, then
run the signing adapter. It writes the signed transaction to an external
mode-`0600` file without broadcasting:

```sh
npm run release:ledger-sign -- /absolute/external/release/manifest.json \
  /absolute/external/next-intent.json \
  --expected-release APPROVED_SHA256 \
  --derivation-path "m/44'/60'/0'/0/0" \
  --cast /absolute/path/to/pinned/foundry/cast \
  --output /absolute/external/signed-transaction.json
```

The adapter validates the intent before prompting the device, verifies the pinned Foundry version/commit and Ledger address, and independently decodes the resulting signature. See [LEDGER-SIGNING.md](../../contracts/core/operations/LEDGER-SIGNING.md). The signed JSON is accepted directly by the broadcast command:

```sh
RPC_URL=... npm run release:mainnet -- broadcast /absolute/external/release/manifest.json \
  --expected-release APPROVED_SHA256 \
  --journal /absolute/external/mainnet-journal.json \
  --signed /absolute/external/signed-transaction.json \
  --report /absolute/external/mainnet-broadcast.json \
  --confirmations 2
```

Before any network write, the command requires chain 1 and verifies the recovered signer, CREATE `to = null`, zero value, nonce, complete initcode and hash, gas limit, both EIP-1559 fee fields, empty access list and reviewed unsigned serialization. It atomically stores the raw transaction in the external journal before calling the provider's raw-broadcast method. Only one deployment transaction may be pending. Every invocation handles one graph step and exits; rerun `intent` only after the prior receipt/runtime is verified.

On restart, the tool searches for the same signed hash. A matching pending or mined transaction is adopted and verified without rebroadcasting a replacement. Every previously completed journal entry is rechecked against its transaction, canonical receipt block, gas evidence and historical runtime. A foreign pending nonce, gap, reorg, changed runtime or missing transaction fails closed. If an RPC accepts the raw transaction but the response times out, the durable `SIGNED_NOT_BROADCAST` entry prevents preparation of the next nonce; rerunning may publish only the same raw bytes/hash.

Do not improvise a replacement transaction. A mined failure or cancellation consumes the nonce and invalidates later CREATE predictions; stop and prepare a new reviewed release plan. A pending replacement procedure, if ever needed, must preserve the exact nonce and initcode, remain within the approved fee policy, and receive a separate review before use.

Two confirmations are the minimum progress checkpoint between CREATE transactions, not final release evidence. Before generating the public deployment record, wait for the collection deployment to be finalized. The external registration JSON must contain exactly two independent HTTPS endpoints on different provider hostnames:

```json
{
  "id": "mycelium-friends-mainnet",
  "label": "Mycelium Friends",
  "networkName": "Ethereum",
  "explorerUrl": "https://etherscan.io",
  "verificationRpcUrls": [
    "https://FIRST_PRIVATE_VERIFICATION_RPC",
    "https://SECOND_INDEPENDENT_VERIFICATION_RPC"
  ]
}
```

Registration independently checks every deployment receipt in exact manifest order, sender, CREATE address, block hash, gas evidence and historical runtime through both providers, then requires that both agree on the common finalized chain. Both verification endpoints must support historical-state reads at every deployment block; a pruned endpoint fails closed. Endpoint URLs and tokens are not copied into `deployments/core/ethereum/mainnet.json`.

After registration, replace every placeholder in the tracked `apps/web/config/mainnet-site.json` with the reviewed browser-public Reown ID, RPC and snapshot API. The site config contains both `https://etherscan.io` (primary) and `https://evm.now` (secondary). Render runs the explicit pair `deployments/core/ethereum/mainnet.json apps/web/config/mainnet-site.json`; a clean clone therefore reproduces the same static output once these two reviewed public records are committed. Browser credentials must be separately scoped and protected by provider-side origin restrictions and rate limits; privileged server secrets are never accepted by this file.

The manifest binds:

- git commit/tree, dirty policy, package JSON/lock, Node/npm, solc package and soljson compiler hash;
- the explicit production release set exported by `release-binding.mjs`: contracts, canonical trait SVGs, the art lock, generated-data inputs, compiler/generator code, and deployment/release verification code;
- actual compiler build version, complete optimizer/viaIR/EVM settings, all compiled source hashes and generated-source hashes;
- art approval and catalog fingerprints/counts, which include current labels, descriptions and data;
- explicit config, signer, nonce sequence, predicted CREATE addresses, symbolic dependency graph and resolved constructor arguments;
- creation bytecode, full initcode including arguments, runtime templates and exact runtime hashes after binding compiler-declared immutable slots by AST declaration;
- the internal SVGHeaderStore and raw SVGHeaderPages created by GenotypeDescriptor.

Preflight re-compiles and compares the entire candidate to the independent digest and current clean sources. It checks chain, latest/pending deployer nonce, available balance, fee cap, vacant predicted addresses, role code hashes and the treasury receiving path at a pinned block. It rechecks nonce, block hash and source identity before returning success. A mismatch throws and exits nonzero; no transaction is sent. A failed run does not authorize use of an older successful report.

Documentation, screenshots, reports, browser-only tooling, local-chain helpers, CI configuration, and synthetic test fixtures are intentionally outside that release set. They may still make the repository dirty (and therefore block release preparation), but their bytes do not silently redefine an otherwise identical production candidate.

The treasury check uses `eth_call` with an explicit temporary balance override for the predicted NFT sender. It tests empty calldata and the approved amount against current recipient state without sending ETH. An RPC that cannot simulate overrides causes failure. This is a receiving-path probe, not a full withdrawal simulation: actual withdrawal, wallet control, amount-dependent policies and future changes still require review. A malicious or upgraded treasury can later refuse ETH, and the immutable treasury cannot be replaced.

## After separately approved deployment

Save receipts and actual addresses; the address map must exactly match the approved predictions. Before allowlist configuration or minting:

```sh
RPC_URL=... npm run release:verify -- /absolute/external/release/manifest.json \
  /absolute/external/mainnet-broadcast.json APPROVED_SHA256

npm run release:verification -- /absolute/external/release/manifest.json \
  APPROVED_SHA256 /absolute/external/source-verification
```

Verification retains the existing full runtime/getter/art/metadata/launch-state checks and additionally checks every exact bound runtime hash, including internal header contracts. Production verification requires the independent digest as well. Fresh compilation is authoritative; older tracked `output/contracts` snapshots are never used as release inputs.

Before sale opening, also complete actual target-fork deployment/withdrawal rehearsal, source verification on Etherscan and Sourcify where supported, receipt/sender/nonce review, Safe ownership acceptance where applicable, and real RPC/marketplace metadata acceptance. EVM.NOW is exposed as a secondary explorer link, not treated as a substitute verification service. `PREFLIGHT_PASSED_NOT_BROADCAST` is a successful snapshot check, not deployment approval and not a claim that those external steps are complete.

`release:verify` is permanently the untouched-deployment gate: it must fail after legitimate minting, phase changes or ownership acceptance. For later read-only operations use the separate health command:

```sh
RPC_URL=... npm run release:health -- \
  /absolute/external/release/manifest.json \
  /absolute/external/mainnet-broadcast.json \
  APPROVED_SHA256
```

Live health preserves exact runtime/immutable/protocol checks but reports mutable owner, pending owner, phase, supply counters, royalty receiver/rate, validator and phenotype source under their allowed invariants. A live-health PASS is not evidence that the deployment was initially untouched.

## Public repository snapshot

The clean public repository starts from the explicit, history-free snapshot procedure in [PUBLIC-REPOSITORY-EXPORT.md](PUBLIC-REPOSITORY-EXPORT.md). `npm run release:export-repo -- --check` validates public path classification, the private boundary, static references and the selected-file secret scan without creating an artifact. The real export requires a clean checkout and an explicit non-existing destination outside the development repository; it never initializes or publishes a Git repository.


## Mint protocol release boundary

New manifests bind `mintProtection`: domain, 60-second minimum, 24-hour expiry, public reveal selector, allowlist-only direct routes, the `phased-v1` sale lifecycle and fully funded atomic-refund payment. The deployment verifier checks protocol constants and the initial fully paused state alongside existing runtime/address/role checks. ABI, sources and bytecode changes invalidate old independent digests. Prepare a fresh candidate only after final bytecode review; no previous approval applies to it.

`node tooling/release/register-deployment.mjs manifest.json mainnet-broadcast.json registration.json EXPECTED_DIGEST` passes the independently approved digest and broadcast evidence through the verifier and registers `commit-reveal-v1`. Production verification compares addresses with the manifest and live runtime. Production preflight remains read-only. Target-fork rehearsal, a physically tested Ledger/offline signing procedure, final independent approval and explicit execution authorization remain separate gates.
