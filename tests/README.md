# Tests

| Group | Responsibility |
| --- | --- |
| `collection/unit/` | Art, catalog, editorial and token-identity invariants |
| `apps/web/unit/` | Browser pricing, marketplace, fundraising and geometry helpers |
| `apps/web/protocol/` | Chain reads, protected mint state/recovery and stale-wallet safety |
| `apps/web/integration/` | Allowlist-client and truthful ownership integration regressions |
| `contracts/core/protocol/` | Contract protocol-model regressions |
| `contracts/core/fixtures/` | Solidity test-only contracts; never production deployment inputs |
| `release/` | Release binding, signing, network policy, packaging, source verification and secret containment |

`npm test` builds generated inputs and uses recursive Node test discovery. It runs additional private test suites when present, without depending on them in a public snapshot. Browser and expensive EVM entrypoints live in `tooling/testing/`, not automatic unit discovery.

## Self-contained CI

Use Node 24.22.1 and npm 11.19.1. From a committed clean checkout:

```sh
npm ci
npm test
npm run check:references
npm run test:artwork-lock
npm run test:catalog
npm run test:redteam
npm run test:m4
npm run test:allowlist-browser
npm run test:mint-ux
npm run test:spiral
npm run build
npm run test:chain
npm run check:clean
```

`test:redteam` includes contract adversarial probes, the differential model and mutation suite. Mutants are compiled in memory or tested in temporary directories; canonical contracts are not patched. Secret-containment regressions run within `npm test`. `check:references` checks static relative imports/file URLs, local documentation links and public/private boundaries. `test:chain` is the comprehensive real-art local EVM suite, intentionally run after structural changes are complete.

`test:m4` runs the static web checks, exports the mainnet read-only profile,
checks the exported site's quality, and runs `test:mint-protection`. Its name is
an existing npm entrypoint; the individual commands can also be used when
investigating a failure. `check:clean` is the final generated-file drift gate and
is expected to fail in a working tree with intentional uncommitted edits.

Browser checks require Chrome (`CHROME_PATH` override). Mint UX covers 320, 390, 768, 1024 and 1440 pixels. For site-based checks, use `SITE_URL` to select a dedicated server from this checkout; do not accidentally test another worktree already serving port 4173. `test:browser` requires the local server, chain and fresh deployment. `test:snapshot-startup` requires a configured live snapshot with at least 21 minted positions. Neither is part of self-contained unattended CI.

## Operator-driven release checks

The [mainnet fork rehearsal](../docs/contracts/core/operations/MAINNET-FORK.md) requires an explicitly pinned block/hash and an upstream RPC. The manually dispatched workflow is not an ordinary offline CI check. Mainnet read-only role checks, external source verification and hardware signing require their own inputs/authorization. A green local suite is not evidence that external steps have been completed.
