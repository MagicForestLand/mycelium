# Renderer override analysis

The deployed collection supports bounded visual overlays, not a general image
replacement. This decision explains that boundary; it does not modify the
immutable renderer. See [core architecture](../architecture/ARCHITECTURE.md) for
the full trust model.

The current immutable interface has no generic `imageURI()`, raw-SVG return value, or external-image override. `IPhenotypeSource.phenotype()` can return only bounded 80×80 run-length overlays plus a bounded message. `PhenotypeRenderer` always starts from `GenotypeDescriptor.renderSVG(genotype)` and inserts the optional overlay before the closing SVG tags.

This means a future phenotype source can visually cover the complete 80×80 canvas only when the replacement compresses into the existing limits: at most 192 horizontal runs, 1,152 run bytes and the renderer's SVG/URI bounds. The original birth image and traits remain underneath and remain independently available through `originalSVG()`. Arbitrary detailed pixel art, arbitrary SVG markup, an arbitrary `data:` URI, IPFS/HTTPS image switching, animation, or a metadata-level replacement cannot be added later through the existing hook.

After immutable mainnet deployment, a true generic full-image override is therefore unavailable. It cannot be recovered by replacing only `phenotypeSource`; it would require a different NFT/renderer architecture or a new collection/wrapper.

Adding a generic override to a future collection would change its phenotype ABI
and renderer logic. It would need an explicit trust and failure policy, bounded
return data, and new metadata, gas, reentrancy, marketplace, authorization and
fallback tests. An external image URI would also introduce an availability
dependency absent from the current on-chain image. Bytecode size and deployment
gas would need to be measured for that concrete design.

Conclusion: the current hook already permits bounded, potentially full-canvas visual skins, but not a generic complete-image replacement. The limitation is deliberate and should remain unless the project separately approves the expanded trust model and a new full test cycle.
