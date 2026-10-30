# Pinned mainnet-fork rehearsal

The fork rehearsal deploys the exact approved production manifest into a local Anvil process backed by a pinned Ethereum mainnet block. It never sends a transaction to the upstream RPC. The upstream endpoint is read-only state storage for Anvil; every deployment and lifecycle transaction targets loopback only.

This is a release gate, not a replacement for Sepolia or final read-only mainnet preflight. Run it again for the final manifest after roles, deployer nonce, gas limits and fee caps are frozen.

## Fixed environment

- Foundry/Anvil: `1.7.1`, pinned by the release tooling rather than selected as the latest version.
- Anvil hardfork: `osaka`, the execution hardfork active on mainnet after Fusaka.
- Chain ID exposed by the local fork: `1`.
- EIP-7825 transaction cap: enabled explicitly with `--enable-tx-gas-limit`.
- Fork block number and hash: both mandatory and recorded in the external report.
- The repository-managed runner starts Anvil on loopback itself; callers cannot substitute a pre-existing node.
- Two independent HTTPS mainnet RPC providers must agree that the pinned block/hash is finalized.

Do not use `--hardfork latest`: its meaning changes when Foundry changes. Osaka
is the ruleset recorded for this deployment rehearsal. Before a new release,
check the target block's actual mainnet rules and the pinned Foundry build.
Update the runner and review its evidence if the target environment has changed.

## Prepare the isolated fork

First obtain one recent finalized mainnet block number and hash. The runner independently reads that block and each provider's `finalized` head through two different HTTPS provider hostnames. Download the official Foundry archive, verify its published archive checksum before extraction, then calculate and independently record the extracted `anvil` binary SHA-256.

Do not start Anvil manually. The runner verifies the executable SHA-256, embedded version and commit, starts that exact file with repository-owned arguments, connects only to its explicit loopback port and stops the child process after the run. Its report contains a secret-redacted launch transcript. Provider paths, query strings and credentials are never copied into the report.

## Run the exact manifest

```sh
UPSTREAM_MAINNET_RPC=https://FIRST_PROVIDER_PRIVATE_URL \
SECONDARY_MAINNET_RPC=https://SECOND_INDEPENDENT_PROVIDER_PRIVATE_URL \
npm run release:fork -- \
  /absolute/external/release/manifest.json \
  --expected-release APPROVED_SHA256 \
  --fork-block PINNED_BLOCK_NUMBER \
  --fork-hash 0xPINNED_BLOCK_HASH \
  --anvil /absolute/path/to/pinned/foundry/anvil \
  --expected-anvil-sha256 APPROVED_EXTRACTED_BINARY_SHA256 \
  --port 19546 \
  --report /absolute/external/mainnet-fork-report.json
```

The runner fails unless the child identifies as Anvil v1.7.1 at the pinned Foundry commit, `anvil_nodeInfo` reports Osaka, chain ID is 1, and the fork is still pristine at the exact pinned block/hash. It behaviorally proves the EIP-7825 boundary by accepting a harmless loopback transaction at `16,777,216` gas and rejecting an otherwise identical transaction at `16,777,217`, then restores the pristine snapshot before deployment. It reconstructs and validates the manifest, funds and impersonates the approved deployer only inside Anvil, and sends the exact CREATE sequence with the manifest gas/fee fields.

It then verifies:

- every predicted CREATE address, initcode-bound runtime and internal SVG header contract;
- the complete untouched deployment state: owner/roles, supply zero, paused sale, pricing constants, metadata/art wiring and no launch validator/phenotype source;
- allowlist allocation and free claim, irreversible transition to public, public price step, pause/resume and public mint;
- withdrawal into the manifest treasury and a 50M-gas metadata call;
- for the Safe-owned manifest, all collection admin calls through the release-bound `1/1` Safe configuration and proof that owner, treasury and royalty receiver use the intended Safe address;
- rollback to an untouched checkpoint and a second complete untouched-state verification;
- final rollback of the entire local deployment to the pristine pinned fork root, on success or failure.

For a contract owner, the runner automatically loads the release-bound Safe
policy and checks it before deployment, after the isolated lifecycle and again
after checkpoint rollback. It binds the Safe proxy/singleton code hashes,
version, owners, threshold, nonce, modules, guards and fallback handler. It tests
the policy bound to that manifest, not a hypothetical later signer
configuration. Synthetic CI uses an EOA fixture and therefore skips this check.

The report is written outside the repository with mode `0600`. It embeds the release digest, exact Anvil binary digest, embedded version/commit, sanitized launch transcript, provider host identities, finalized-head evidence, pinned block/hash, observed hardfork and transaction-cap boundary. The repository-managed Anvil child is stopped after the run; its accounts, balances and transactions are test-only.

## Manual release CI rehearsal

`.github/workflows/release-rehearsal.yml` is a manually dispatched, non-signing rehearsal. Configure a protected GitHub environment named `release-rehearsal` with secrets `MAINNET_FORK_RPC_URL` and `SECONDARY_MAINNET_FORK_RPC_URL`. Both endpoints must support historical state at the chosen block and use different provider hostnames. Enter the reviewed finalized block number and exact hash.

The job prepares a fixed-role synthetic production manifest, builds and validates a synthetic production site export, downloads Foundry v1.7.1 for Linux from the official release and checks SHA-256 before extraction, starts Anvil locally, and runs the same loopback-only fork lifecycle. It uploads only `ci-context.json`, the static-site manifest and the fork report for 14 days. The upstream URL, Anvil log, manifest, signer data and raw transactions are not uploaded. There is no signer or mainnet broadcaster in this workflow.

The workflow is supply-chain and integration evidence only. Its fixed synthetic roles are deliberately unusable and its manifest must never be signed or broadcast. It does not close the future exact-manifest fork gate.
