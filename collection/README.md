# Collection source

This is the single source of truth for Mycelium Friends, shared by the Ethereum generation pipeline and browser renderer. It is not frontend-owned data.

| Location | Role |
| --- | --- |
| `catalog/catalog.json` | Authored trait identities, order, palette, base bead data and edition selections |
| [artwork/](artwork/README.md) | Authored SVG overrides and reviewed artwork release lock |
| `source/art.js` | Canonical vector renderer and catalog assembly |
| `source/editorial.js` | Collection and token descriptions, category introductions and project copy |
| `source/metadata.js` | Token metadata model |
| `source/token-id.js` | Genotype packing and token identity helpers |
| `source/artwork-validation.js` | Validation for authored artwork |
| `generated/bead-data.js` | Generated catalog plus SVG overrides; never edit by hand |

Run `npm run build:beads` from the repository root to regenerate bead data and then build. `npm run build` generates Solidity art banks/schema/SVG constants/metadata under `contracts/core/generated/`, the collection content reference under `docs/collection/`, browser bundles under `apps/web/`, and ignored previews/manifests under `output/`.

The [artwork lock](artwork/release-manifest.json) binds source hashes, trait identities and order, rendered/data hashes, edition hashes, collection generator, approved genotype `3,0,1,0,0,30`, and exact avatar/banner hashes. `npm run test:artwork-lock` verifies it. Do not refresh the lock merely to silence a failing test: compare and review the underlying changes first.

See [artwork architecture](../docs/contracts/core/architecture/ARTWORK.md) for the full lineage, and [contract architecture](../docs/contracts/core/architecture/ARCHITECTURE.md) for how generated data is stored and rendered on Ethereum.
