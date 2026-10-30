# Artwork and generation

The browser and Solidity renderer share one reviewed art model. Authored SVGs
and catalog data produce the on-chain art banks; a release lock makes changes
to those inputs explicit and reviewable.

The production catalog contains 244 canonical trait variants:

| Layer | Count |
| --- | ---: |
| Stem | 32 |
| Cap | 128 |
| Temperament | 32 |
| Glasses | 16 |
| Accessory | 4 |
| Hobby | 32 |

`collection/catalog/catalog.json` defines IDs, order, names, descriptions, base bead data, and sample compositions. `collection/artwork/traits/` contains 218 edited SVG overrides. The remaining variants come directly from the base catalog. File count is therefore not the canonical trait count.

The table follows genotype order. Back-to-front drawing order is Stem,
Temperament, Glasses, Cap, Accessory, Hobby, as defined by `renderLayerKeys` in
`collection/source/art.js` and generated into `SVGConstants`. This lets the cap
overlap the face consistently in the browser and on-chain SVG.

## Build and release lock

`npm run build:beads` validates editor metadata, applies one SVG override for each
trait that has an authored override, and regenerates
`collection/generated/bead-data.js`, generated Solidity, previews, metadata and
frontend output. Traits without an override retain their base catalog data. The
command must never be used to refresh the release lock implicitly.

`collection/artwork/release-manifest.json` is a format-3 `CURRENT_RELEASE_LOCK`. `npm run test:artwork-lock` compares the active catalog and authored SVGs against it. It also binds `tooling/lib/generate-metadata.mjs`, canonical collection genotype `3,0,1,0,0,30`, and deterministic avatar/banner hashes. Updating the lock requires an explicit review reason. Release preparation binds its summary and all relevant source hashes.

Source paths are part of the lock. Moving a generator changes its path binding and may change import statements, even when every rendered byte is identical. Such a change requires a reviewed lock refresh, not removal of path/content binding. Canonical SVGs, trait IDs/order, bead data, editorial and generated production Solidity must be compared separately.

Historical experiments, deferred variants, one-off installers and visual review output are not production inputs or dependencies of the public source release.
