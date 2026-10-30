# Canonical artwork

`traits/` contains the canonical edited SVG source for the current production catalog. Each file is an editor-format SVG with exactly one trait override. Traits without an override remain defined by `collection/catalog/catalog.json` and generated bead data.

`release-manifest.json` is the format-3 production artwork lock. It fixes layer/render order, trait IDs/order, per-trait SVG/data hashes, edition hashes, source hashes and the aggregate catalog hash. It also binds the collection generator source, genotype `3,0,1,0,0,30` and exact avatar/banner hashes. A source-path rename changes the aggregate hash but must not change approved SVG bytes, bead data, trait identity/order or generated Solidity.

The public build is self-contained and does not read private history or experimental artwork. See [artwork architecture](../../docs/contracts/core/architecture/ARTWORK.md) for canonical inputs and generation, and the [documentation index](../../docs/README.md) for release verification. Generated previews/bundles live in ignored output directories, not beside the authored SVGs.
