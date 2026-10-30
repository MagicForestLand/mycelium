# Deployment records

[`core/ethereum/mainnet.json`](core/ethereum/mainnet.json) records the separately authorized and verified first
Ethereum mainnet deployment. It contains the current release identity, collection
and module addresses, finalized deployment evidence, runtime/catalog hashes and
initial role addresses. It records deployment state, not a live sale status or
current signer configuration. The treasury is immutable; ownership, royalty
settings and Safe signers can change through their respective administration
paths. Use the [live-health procedure](../docs/repository/release/RELEASE.md#after-separately-approved-deployment)
for current contract state. Historical preparation and private journals are not
stored here.

Only durable verified deployment evidence belongs here. Each record must bind the approved release, catalog and deployed addresses; a historical snapshot is not proof of current bytecode. See the [deployment runbook](../docs/contracts/core/operations/DEPLOYMENT.md) and [release integrity](../docs/repository/release/RELEASE.md).

Local diagnostics are ignored under `.dev/deployments/`. Production manifests, signing payloads, transaction journals and verification reports are created outside the repository. Never commit private keys, signed transactions or donor data.
