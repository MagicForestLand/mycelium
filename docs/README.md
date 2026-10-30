# Documentation

mycelium Friends combines a fully on-chain art collection, a browser Builder and
Spiral, and a real-world project supporting Magic Forest. The
[project overview](../README.md) tells the story. The
[system architecture](ARCHITECTURE.md) explains how collection source,
contracts, the website, deployments and verification fit together.

## Start with your task

| I want to… | Start here |
| --- | --- |
| Understand the whole system | [System architecture](ARCHITECTURE.md) |
| Explore the collection and its six traits | [Collection source](../collection/README.md) and [artwork architecture](contracts/core/architecture/ARTWORK.md) |
| Understand the contracts | [Core contract documentation](contracts/core/README.md) |
| Understand minting, prices or recovery | [Mint lifecycle and API](contracts/core/architecture/MINTING.md) |
| Understand the website, wallets or Spiral | [Web architecture](apps/web/ARCHITECTURE.md) |
| Check what administrators can change | [Core contract architecture](contracts/core/architecture/ARCHITECTURE.md), [royalties](contracts/core/architecture/ROYALTIES.md) and [Safe operations](contracts/core/operations/SAFE-OPERATIONS.md) |
| Verify the mainnet release | [Deployment records](../deployments/README.md) and [source verification](../verification/README.md) |
| Run or contribute to the project | [Setup](../README.md#setup), [contributing](../CONTRIBUTING.md) and [tests](../tests/README.md) |
| Prepare or operate a release | [Repository and release documentation](repository/README.md) |

## Documentation map

```text
docs/
├── README.md                       reader routes and terminology
├── ARCHITECTURE.md                 whole-system map and boundaries
├── apps/web/                       browser application architecture
├── collection/                     generated collection reference
├── contracts/core/                 deployed contract-domain documentation
│   ├── architecture/               behavior and public interfaces
│   ├── decisions/                  durable design rationale
│   ├── operations/                 operator procedures
│   └── security/                   dated technical reviews
├── readme-assets/                  repository overview illustrations
└── repository/                     structure, release and public export policy
    ├── release/
    └── security/
```

The tree mirrors production ownership. `core` means the current Mycelium Friends
contract domain under `contracts/core/`; it does not mean the entire project.
`repository` contains cross-domain maintenance and publication rules, not a
product runtime. The [repository structure policy](repository/REPOSITORY-STRUCTURE.md)
explains how future applications and contract domains are added.

## Architecture

- [System architecture](ARCHITECTURE.md)
- [Core contract documentation](contracts/core/README.md)
- [Core contract and storage architecture](contracts/core/architecture/ARCHITECTURE.md)
- [Canonical artwork, generation and release lock](contracts/core/architecture/ARTWORK.md)
- [Mint lifecycle, pricing, protection and recovery](contracts/core/architecture/MINTING.md)
- [Royalties and transfer validation](contracts/core/architecture/ROYALTIES.md)
- [Frontend and runtime configuration](apps/web/ARCHITECTURE.md)

## Operations

- [Deployment sequence and closed-sale handoff](contracts/core/operations/DEPLOYMENT.md)
- [Pinned mainnet-fork rehearsal](contracts/core/operations/MAINNET-FORK.md)
- [Ledger signing](contracts/core/operations/LEDGER-SIGNING.md)
- [Safe administration, treasury and signer policy](contracts/core/operations/SAFE-OPERATIONS.md)
- [Production release binding and approval gates](repository/release/RELEASE.md)

## Security and decisions

- [Compiler review](contracts/core/security/COMPILER-BUG-REVIEW.md)
- [Static-analysis review and limitations](contracts/core/security/STATIC-ANALYSIS-REVIEW.md)
- [Dependency review](repository/security/DEPENDENCY-REVIEW.md)
- [Renderer override decision](contracts/core/decisions/RENDERER-OVERRIDE-ANALYSIS.md)
- [Security reporting policy](../SECURITY.md)

Project-maintained reviews are transparent release evidence, not independent
third-party audits. Dated reviews describe their recorded state and must be
refreshed when their inputs change.

## Repository and generated reference

- [Repository and release documentation](repository/README.md)
- [Repository structure, placement and naming rules](repository/REPOSITORY-STRUCTURE.md)
- [Public export profiles and provenance](repository/release/PUBLIC-REPOSITORY-EXPORT.md)
- [Generated collection content](collection/COLLECTION-CONTENT.md) — marketplace
  text, trait descriptions and curated compositions derived from canonical
  collection inputs; do not edit by hand
- [Deployment records](../deployments/README.md)
- [Source-verification artifacts](../verification/README.md)
- [Licensing and third-party notices](../LICENSING.md)
- [Release history](../CHANGELOG.md)

The generated collection document is a reproducibility reference, not the
recommended starting point for a new reader.

## Names and source of truth

Use **mycelium Friends** for the public brand and **Mycelium Friends** for the
exact on-chain collection name (`MYFRIENDS`). A **myFriend** is one character;
`MyceliumFriends` is the Solidity contract. **Magic Forest Association** is the
Spanish non-profit behind the project; **Magic Forest Friends LLC** is the
designated primary-sale operator. Their purpose and relationship are described
in the [project overview](../README.md).

A *genotype* is the six chosen trait indices; a *token ID* is the sequential
mint number. The *Spiral* is the chronological collection view. Its Archimedean
geometry is independent of the linear public price curve. Use *allowlist* for
the contract phase; donor eligibility is a project policy implemented through
wallet quotas.

The generated collection content preserves release-bound editorial text. Its
phrase “No reveal to wait for” refers to seeing the chosen artwork before
minting; public purchases still require the two-transaction commit/reveal
protocol. Update generated content through its canonical source and release
process, never by hand.

Working plans and historical experiments are not public product documentation.
Public documentation and tests must remain usable without private development
history.
