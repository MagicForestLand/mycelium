# Deployment guide

The first mainnet deployment is recorded in the
[deployment registry](../../../../deployments/README.md). This guide describes the
release procedure; its initial-state checks are not a statement about the
collection's current sale phase.

Preparation, verification, signing, broadcasting and opening sales are separate actions. No script grants authorization to send a transaction merely by existing. The public workflow is described in [release integrity](../../../repository/release/RELEASE.md), [mainnet fork rehearsal](MAINNET-FORK.md) and [Ledger signing](LEDGER-SIGNING.md).

## Local rehearsal

Run these commands from the repository root in separate terminals:

| Terminal | Command | Result |
| --- | --- | --- |
| 1 | `npm run local:chain` | Keep the local chain running |
| 2 | `npm run local:deploy` | Deploy local contracts and write browser configuration |
| 3 | `npm start` | Serve the site at `http://127.0.0.1:4173/` |

Install dependencies and build first using the [setup guide](../../../../README.md#setup).
Local deployment creates ignored `apps/web/chain-config.json` and
`.dev/deployments/` diagnostics. These are not durable release evidence.

## Mainnet sequence

1. Freeze a clean exact source commit, complete [CI checks](../../../../tests/README.md) and verify the public snapshot independently.
2. Review explicit owner, treasury, royalty receiver, deployer, sale cap, validator policy, nonce, role code hashes, gas limits and maximum fees. Treasury and sale cap cannot change after deployment. Use the [Safe runbook](SAFE-OPERATIONS.md); do not confuse the deployer with the collection owner.
3. Prepare the release outside the source repository with `release:prepare`, then independently review and approve its digest. The manifest binds source/toolchain/configuration, constructor arguments, predicted addresses, initcode and runtime hashes.
4. Complete the pinned loopback-only mainnet fork rehearsal and read-only `release:preflight`. A rehearsal is not a mainnet broadcast.
5. Follow the Ledger/mainnet runbooks to produce, inspect and separately authorize exact transactions. Do not reuse an approval after changing source, manifest, nonce, fees or deployment parameters.
6. Verify deployed bytecode, getters, ownership, treasury and metadata with `release:verify` before any sale action. Record receipts and reports outside the repository, then register durable verified deployment evidence in `deployments/core/ethereum/mainnet.json`.
7. Complete external source verification and production runtime configuration. `export:site` requires the verified deployment record and reviewed site configuration before producing the Render publish directory.
8. Keep the collection closed until the owners explicitly authorize allowlist setup/start and the later public transition. Successful deployment does not start sales. Before each sale authorization, verify the current organizational approval and Safe control; changing Safe signers does not change the treasury address embedded in the NFT.

If execution is interrupted, do not blindly retry: existing predicted addresses must form a contiguous verified prefix, runtime hashes must match, and the deployer must have no unexplained pending nonce. Resolve discrepancies before another signature or broadcast.

External explorer/source verification, hardware-wallet operation, marketplace rendering, real treasury receipt and public RPC compatibility require separate evidence. Local tests do not prove these integrations. Deployment, sale start and publication remain separate operator decisions; this runbook authorizes none of them.
