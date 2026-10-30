# Source verification

This tree contains immutable, release-scoped source verification artifacts for independently deployable Mycelium components. Programs that create or validate those artifacts live under `tooling/verification/` and `tooling/release/`.

Core releases use:

```text
verification/core/releases/<release-digest>/
```

Each release directory binds an approved release digest to the exact Solidity Standard JSON input, development-source identity, source hashes, compiler settings, constructor data and expected bytecode hashes. A predeployment capsule is reproducibility evidence only; it is not evidence of a mainnet deployment or source-code verification by a block explorer.

The private development repository does not duplicate an exported capsule. After
publication, `verification/core/release-index.json` binds each deployment release
digest and source identity to the exact public repository commit, capsule path and
SHA-256 hashes. A public/full-project checkout also contains the indexed release
directory, allowing CI to verify those files locally without a network request.

The development repository and a minimal public capsule have intentionally different Git identities. `SOURCE-SNAPSHOT.json` records the development commit and tree but never claims that identity for the exported capsule and never attempts to predict the capsule's future commit hash.

Release directories are append-only. Never replace an existing digest directory with different content.

To reproduce a capsule, use the exact compiler version recorded in `verification-summary.json`:

Run the following inside a published capsule or full-project checkout containing
the indexed release directory and `verification/verify-standard-json.mjs`.
Replace `<digest>` with the approved release digest. The private development
checkout contains the index, not a duplicate of these exported files.

```sh
solc --standard-json < verification/core/releases/<digest>/standard-json-input.json > compiler-output.json
node verification/verify-standard-json.mjs compiler-output.json verification/core/releases/<digest>/verification-summary.json
```

The verifier uses only Node.js built-ins and compares every deployment artifact's ABI, semantic storage layout, creation bytecode and runtime template. Semantic storage-layout hashing preserves contracts, labels, slots, offsets, type structure and byte widths while excluding compiler-internal `astId` and type identifiers, which can change with Standard JSON source ordering without changing storage. Check `solc --version` against the summary before compiling. Constructor arguments and expected deployed runtime hashes remain separately bound in the summary.
