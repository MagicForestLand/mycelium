# Changelog

All notable public releases and material fixes are recorded here. The format follows Keep a Changelog principles; release tags, not this file alone, identify exact source.

## Unreleased

### Added

- First-party, country-level mint evidence linked to wallet and confirmed Ethereum transaction, with an authenticated tax CSV export in the existing Magic Forest admin.
- A quiet first-visit privacy notice with plain-language detail in About, separate from the mint flow.
- Mainnet release manifest, Ledger signing, fork rehearsal, recovery journal, source-verification and live-health tooling.
- Explicit history-free public repository and static-site export procedures.
- CC0/MIT licensing split, security policy and contributor guidance.

### Changed

- Public tools, tests and documentation are grouped by responsibility; historical interfaces and working plans are isolated behind one private export boundary.
- Public mint price step is `0.0001 ETH`; allowlist minting remains free.
- Canonical public site origin is `https://mycelium.magicforest.land/`.
- Contract and client terminology uses the final allowlist/public naming.
- Public-repository CI is self-contained before the first mainnet deployment and no longer depends on excluded Sepolia/transition sources.
- Collection publication copy is generated from the canonical editorial and art catalog instead of being maintained as a separate manual copy.

### Security

- Mint location is derived server-side; IP evidence is encrypted at rest, hidden from the ordinary admin UI and decrypted only for the authenticated tax export under the reviewed retention schedule.
- Production deployment evidence requires exact manifest/runtime checks and agreement from two independent archival RPC providers on the finalized chain.
- Public minting uses buyer-bound commit/reveal; production exports reject test-network deployment records and placeholder wallet configuration.
- Artwork lock format 3 binds the collection generator, genotype and exact avatar/banner hashes in addition to the full trait catalog.

The entries above describe repository work awaiting its next public snapshot.
The deployed core release is recorded separately below.

## mycelium-friends-core-v1.0.0

The first Ethereum mainnet core release is recorded at block `26259980` in the
[verified deployment record](deployments/core/ethereum/mainnet.json).

- Collection: `0x49f3A83a8EE0B1BB4334c5Fa997565926234648F`.
- Source commit: `5b7d890039dc0c660fabaa8b03c5f0b5a8654e86`.
- Release digest: `bf164a80af6f614241126ad0959777f013c494c3327064db353e5647dde5eb1e`.
- Initial state: `PAUSED`, supply zero; the deployment did not open minting.

The [verification index](verification/core/release-index.json) binds this release
to its public source capsule. Later website or documentation changes do not
modify the deployed core.
