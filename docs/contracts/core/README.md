# Core contract documentation

This section documents the Mycelium Friends contract domain in
[`contracts/core/`](../../../contracts/core/), named `core` in the repository.
For its relationship to the website, collection source and release tools, see
the [system architecture](../../ARCHITECTURE.md).

The domain owns collection identity, minting, on-chain metadata and rendering,
royalties, optional transfer validation, phenotype boundaries and the associated
deployment procedures. The browser application, authored collection source and
repository-wide release policy have their own owners.

## Read by purpose

- [Core contract architecture](architecture/ARCHITECTURE.md) — components,
  storage, authority and immutable boundaries
- [Artwork and generation](architecture/ARTWORK.md) — canonical inputs,
  generated Solidity and release locking
- [Mint lifecycle and API](architecture/MINTING.md) — phases, pricing,
  commit/reveal and recovery
- [Royalties and transfer validation](architecture/ROYALTIES.md) — ERC-2981 and
  the optional validator boundary
- [Deployment operations](operations/DEPLOYMENT.md) — rehearsal and mainnet
  sequence
- [Ledger signing](operations/LEDGER-SIGNING.md),
  [mainnet-fork rehearsal](operations/MAINNET-FORK.md) and
  [Safe operations](operations/SAFE-OPERATIONS.md)
- [Compiler review](security/COMPILER-BUG-REVIEW.md) and
  [static-analysis review](security/STATIC-ANALYSIS-REVIEW.md) — dated release
  evidence, not independent audits
- [Renderer override decision](decisions/RENDERER-OVERRIDE-ANALYSIS.md) — why
  the phenotype hook is bounded

Generated files under `contracts/core/generated/` are build products. Change
their canonical collection inputs or generator, then rebuild and verify exact
output; never maintain generated Solidity by hand.

Future contract domains should be siblings of `contracts/core/` with matching
documentation under `docs/contracts/`. They should not be added inside this
domain merely because `core` existed first.
