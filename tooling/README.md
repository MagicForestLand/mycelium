# Tool guide

Run commands from the repository root using the pinned Node/npm versions. `package.json` is the command index; this directory groups responsibility rather than creating another framework.

| Directory | Purpose and entrypoints |
| --- | --- |
| `build/` | Build art/contracts, browser bundles, bead catalog and verified production site |
| `dev/` | Local server, chain, deployer and optional zsh lifecycle helper |
| `release/` | Prepare manifests/allowlist calls, sign with Ledger, orchestrate mainnet, register deployment, and export a source capsule or later full project |
| `verification/` | Preflight, evidence/bytecode/source/Safe verification, artwork lock, references and checkout checks; loopback-only fork rehearsal |
| `testing/` | Browser/EVM/catalog regressions, adversarial model and mutations, synthetic CI preparation |
| `config/` | Reviewed Safe policy and fail-closed public repository export policy |
| `lib/` | Importable compiler, generators, protocol/deployment plan and release-binding helpers; not CLI entrypoints |

CLI modules outside `lib/` may also export pure validation functions for tests. Direct-invocation guards protect CLI side effects where those functions are imported. `testing/check-allowlist-client.mjs` and `testing/check-allowlist-final-client.mjs` are Node test harnesses (`node --test`), not deployment tools. Library `check-*` modules are assertions invoked by the chain runner.

`lib/broadcast-release.mjs` contains shared manifest/progress checks, with explicit chain guards; there is no public private-key Sepolia CLI. Mainnet operation uses `release/mainnet-release.mjs` and the [Ledger signing runbook](../docs/contracts/core/operations/LEDGER-SIGNING.md). Signing, broadcasting and sale opening require separate explicit operator approval.

Generated sources are checked by `lib/check-generated.mjs` before compilation. Frozen compiler settings and Solidity source names live in `lib/compile-contracts.mjs`. Moving a tool changes release tooling hashes even when Solidity and bytecode stay identical: prepare and approve a new manifest after a source change.

Adversarial and `check-*` tools are project tests, not an independent audit. See the [test guide](../tests/README.md) and [release integrity](../docs/repository/release/RELEASE.md).
