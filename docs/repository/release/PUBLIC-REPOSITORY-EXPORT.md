# Public export profiles

Mycelium has two intentionally different public artifacts. Neither copies the private development Git history, and `internal/` is excluded from both.

## Minimal source-verification capsule

This is the only publication artifact required before a mainnet deployment attempt. It contains:

- `contracts/LICENSE` and the exact `contracts/core/` Solidity source units;
- `verification/README.md` and its dependency-free Standard JSON output verifier;
- `verification/core/releases/<release-digest>/SOURCE-SNAPSHOT.json`;
- the complete Solidity Standard JSON compiler input and verification summary;
- third-party attribution and license text.

The release-scoped snapshot records the development commit/tree, approved release digest and SHA-256 inventory. It does not claim that the capsule has the same Git identity and does not predict the capsule commit. The verification summary is explicitly marked `PREDEPLOYMENT_SOURCE_CAPSULE`; only a later canonical deployment record can prove an on-chain deployment.

After the exact candidate is committed, reproducibly regenerate and independently validate its architecture-equivalence evidence against the approved structural baseline. The generator reads both revisions from Git, requires the candidate to be the clean checked-out `HEAD`, compiles both source layouts with Solidity metadata disabled, validates the current artwork release lock, and writes only to a new external path:

```sh
npm run release:architecture-equivalence -- \
  --baseline 46cd481bb741c2566fc3290b98b1395255c186c1 \
  --candidate "$(git rev-parse HEAD)" \
  --output /absolute/external/architecture-equivalence.json

npm run release:verify-architecture-equivalence -- \
  /absolute/external/architecture-equivalence.json
```

The validator does not trust `allEquivalent`: it regenerates every comparison from the named Git commits and requires byte-for-byte identical deterministic evidence. A failed or incomplete gate produces no approved evidence. The external file is not committed to the development repository.

After preparing and independently approving the production manifest, export to a new external path:

```sh
npm run release:export-capsule -- manifest.json APPROVED_RELEASE_DIGEST architecture-equivalence.json /absolute/path/to/new-capsule
```

The exporter revalidates the clean development source against the approved manifest, fully regenerates the architecture-equivalence comparison, refuses an existing or in-repository destination, rejects failed or mismatched evidence, and writes no Git repository or network state. Independently compile `standard-json-input.json` with the exact compiler version recorded in `verification-summary.json`, compare the reported artifact hashes, inspect inventory/secrets, and only then create the capsule's separate commit/tag.

## Full project export

The later full-project repository contains the public application, collection, contracts, documentation, infrastructure configuration, tooling, tests, verification releases and durable deployment records. This profile is required before repository visibility becomes public and before announcing `mycelium.magicforest.land`; it is not a pre-mainnet gate.

`tooling/config/public-repository.json` is its fail-closed allowlist. Every candidate path must belong to an approved public file/tree or to the single excluded `internal/` boundary. Validate its structure during development:

```sh
npm run release:export-repo -- --check
```

The canonical destination already exists: the private
[`MagicForestLand/mycelium`](https://github.com/MagicForestLand/mycelium)
repository contains the source-verification capsule commit and the verified
mainnet deployment-record commit. Preserve that history. Do not initialize a
third repository, replace `main`, force-push, or remove the indexed capsule.

The development change must first be committed and pushed to
[`MagicForestLand/mycelium-dev`](https://github.com/MagicForestLand/mycelium-dev),
and its complete GitHub CI run must pass. A green local run is necessary but is
not a substitute for that remote gate. Do not commit or push anything to
`MagicForestLand/mycelium` until both conditions are true: the development CI is
green for the exact source commit, and the maintainers have then given separate,
explicit approval for that public-repository commit and push.

After the documentation/application/licensing pass, first export a clean,
committed development source tree to a new empty **staging directory**. The
staging directory is not a Git repository or another publication destination:

```sh
npm run release:export-repo -- /absolute/path/to/new-empty-export-staging
```

The exporter:

- reads existing Git-tracked files from the explicit allowlist;
- rejects unclassified, private, transient, non-regular and secret-like material;
- checks that public imports and documentation links resolve without `internal/`;
- copies files individually and writes `PROJECT-EXPORT.json` with the development commit/tree and per-file hashes;
- does not initialize Git, create a remote, publish, deploy, sign or broadcast anything.

Apply that staging snapshot as a new commit in a clean checkout of the existing
private repository. A copy without `--delete` preserves its immutable capsule;
the final inventory check rejects any other stale or unexpected file:

```sh
MYCELIUM_EXPORT=/absolute/path/to/new-empty-export-staging
MYCELIUM_PUBLIC=/absolute/path/to/existing-mycelium-checkout

git -C "$MYCELIUM_PUBLIC" status --short
git -C "$MYCELIUM_PUBLIC" remote get-url origin
rsync -a --checksum "$MYCELIUM_EXPORT"/ "$MYCELIUM_PUBLIC"/

cd "$MYCELIUM_PUBLIC"
npm ci
npm run release:export-repo -- --check
npm test
npm run check:references
```

The first command must report a clean checkout and the remote must be
`MagicForestLand/mycelium`. When `PROJECT-EXPORT.json` is present,
`release:export-repo -- --check` changes from a development inventory check into
a final-publication gate: every exported hash must match, every indexed capsule
file must exist and match its release index, and no third set of files may
remain. Review `PROJECT-EXPORT.json`, the complete diff and Git history, then
only after that separate maintainer approval commit and push to the existing
private `main`. Run its complete GitHub CI while the repository is still
private. The full-project commit has its own Git identity while retaining the
earlier capsule and deployment commits.

After that private-repository CI passes, bind the reviewed full-project commit
to an annotated release tag and a GitHub Release that names the source commit
and `PROJECT-EXPORT.json` provenance. Pushing the tag is a publication write and
requires the same separate maintainer approval; never infer it from approval to
prepare or test the export.

Keep the repository private until the sales launch. In the launch window,
change its visibility to public, immediately enable GitHub private vulnerability
reporting and verify the **Report a vulnerability** form from a non-admin
account. Do not open sales or announce the repository until that form and the
public CI view work. If the private channel cannot be enabled, restore private
visibility or publish a monitored private contact in `SECURITY.md` first.

`apps/web/config/mainnet-site.json` is intentionally browser-public once finalized. Privileged backend credentials never belong there; browser RPC/Reown values require provider-side origin restrictions and rate limits. The file and `deployments/core/ethereum/mainnet.json` are finalized only after a successful deployment and before the public site gate.
