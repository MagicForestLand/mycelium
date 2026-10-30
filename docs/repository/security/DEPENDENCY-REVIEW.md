# Dependency security review

Snapshot date: **2026-10-29**. Toolchain: Node `24.22.1`, npm `11.19.1`.

This dated review separates code shipped to the browser from local build and
test tools. The lockfile records exact dependency versions; advisory counts must
be refreshed for each release. A historical passing audit is not evidence of
the current advisory state.

## Release result

- `npm audit --omit=dev`: **PASS — 0 vulnerabilities**.
- `npm audit`: **7 vulnerabilities — 1 moderate, 5 high, 1 critical**. Every remaining path is nested under the pinned local-only `ganache@7.9.2` test dependency.
- `follow-redirects@1.16.1` and `tmp@0.2.7` are pinned with npm overrides to remove fixable transitive findings without a breaking top-level change.
- `puppeteer-core` was upgraded from `24.16.0` to `25.16.0`. Its declared Node requirement is `>=22.12.0`, compatible with the project pin. Both `test:mint-protection` and `test:mint-ux` passed after the upgrade.
- No `npm audit fix --force` was run. npm's proposed Ganache remediation installs the old, breaking `ganache@6.4.5`; that is not an acceptable security upgrade.

`npm ci` printed a larger install-time advisory count, while an explicit `npm audit` immediately after the same clean install returned the reproducible seven-finding graph above. Release evidence uses explicit post-install audit commands and their output, not the install progress summary.

## Remaining Ganache findings

The remaining paths are `bn.js` through `elliptic`, `elliptic`, `lodash`, `secp256k1`, and `ws` through `@trufflesuite/uws-js-unofficial`. They are used by local ephemeral EVM tests only:

- Ganache is a dev dependency and is excluded from the production static export.
- It is not used by the mainnet broadcaster, offline transaction verifier, browser runtime, or Render site.
- Tests use an in-process or loopback provider with generated accounts. Real deployer, owner, treasury seeds and private keys must never be supplied to it.
- This limits exposure but does not resolve the advisories. Mainnet-fork rehearsals use the separately pinned Anvil runner described in [MAINNET-FORK.md](../../contracts/core/operations/MAINNET-FORK.md). Ganache remains the local regression harness and is not used by that runner.

## Commands

```sh
npm ci
npm audit --omit=dev
npm audit
npm run test:mint-protection
npm run test:mint-ux
```

Re-run the two audit commands on the frozen release commit. Advisory databases change independently of the source tree, so this dated snapshot cannot be treated as a permanent PASS.

## Maintenance policy

Run both audit commands with the pinned Node/npm toolchain on every frozen
release candidate and at least monthly while the official frontend or a primary
sale is active. Any production dependency finding is triaged before release;
unresolved high or critical production findings block publication. Findings
limited to development tooling require an exposure analysis, a tested upgrade
or replacement assessment, and a dated exception such as the Ganache review
above. Never use `npm audit fix --force` as an approval substitute.

Dependency changes are made and tested in the private development repository,
then carried into the public repository through the reviewed full-project
export. GitHub dependency alerts may provide an additional signal after the
repository becomes public, but automated public update pull requests are not a
substitute for this release process. The maintainer reviewing a release owns
the audit result until the next recorded review.
