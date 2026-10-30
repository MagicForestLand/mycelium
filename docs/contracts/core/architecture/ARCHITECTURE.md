# Core contract architecture

The collection keeps its original artwork and identity on Ethereum. The website
helps people choose, mint and browse; it does not own the data that defines a
Friend. This page describes the immutable core and the administrator's remaining
permissions. For the purchase sequence, see [minting](MINTING.md).

## Immutable collection core

`MyceliumFriends` is a non-upgradeable ERC-721. Each token stores a six-byte birth genotype in this order: Stem, Cap, Temperament, Glasses, Accessory, Hobby. The catalog counts are 32/128/32/16/4/32, producing 268,435,456 (`2^28`) possible genotypes. The commercial `saleCap` is a separate immutable constructor value.

Token IDs are sequential from one. A token ID is not a genotype index. Global identity is `(chainId, collection address, tokenId)`. The contract has no burn, proxy, arbitrary executor, admin mint, or birth-art replacement path.

## On-chain rendering

Generated art banks store compressed bead runs, labels, and descriptions. `GenotypeDescriptor` validates and composes the six traits. `MetadataEncoder` and `PhenotypeRenderer` return self-contained SVG and JSON data URIs. `originalSVG` always exposes immutable birth artwork.

The genotype order differs intentionally from back-to-front rendering order. The generated schema is authoritative; consumers must not duplicate counts or ordering by hand.

An owner-selected `IPhenotypeSource` may add bounded on-chain graphics and a short
message. A failing source or malformed return data falls back to original
metadata. A caller supplying too little render gas receives
`InsufficientRenderGas` rather than an incomplete image. This optional source
can cover the displayed canvas, but cannot change the stored genotype or
`originalSVG`. ERC-4906 signals metadata refreshes. See the
[renderer decision](../decisions/RENDERER-OVERRIDE-ANALYSIS.md) for the exact limits.

## Sales and ownership

The lifecycle is `PAUSED → ALLOWLIST → PUBLIC_ACTIVE ↔ PUBLIC_PAUSED`. Allowlist minting is permanently free and limited by absolute lifetime quotas. Public minting uses buyer-bound commit/reveal and linear pricing based only on successful public mints. Genotypes are unique within the collection; batches contain 1–32 selections and settle atomically.

Primary proceeds go only to the immutable treasury. Ownership uses `Ownable2Step`; renunciation is disabled to retain phenotype and transfer-validator recovery. ERC-2981 royalties are permanently capped at 500 bps. The optional transfer validator starts disabled and can block transfers if enabled.

## Components

- `contracts/core/` — NFT, pricing, settlement, descriptor, renderer, codecs, interfaces;
- `contracts/core/generated/` — deterministic catalog/art/metadata Solidity;
- `collection/catalog/catalog.json` — canonical catalog metadata and base bead data;
- `collection/artwork/traits/` — edited SVG overrides;
- `apps/web/src/chain-*` and `apps/web/src/protected-*` — read/index, wallet, and mint protection clients;
- `tooling/lib/deployment-plan.mjs` — exact dependency graph and constructor plan;
- `tooling/lib/release-binding.mjs` — source/toolchain/config/initcode/runtime binding.

Future games, agents, token-bound accounts, inventories, and rewards belong outside the immutable NFT. They must bind permissions to current ownership and `ownershipEpoch`; ERC-721 approval alone is not authorization for unrelated external actions.
