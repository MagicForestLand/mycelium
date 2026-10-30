# Repository structure

The repository layout is part of the project architecture. New work extends the
existing responsibility domains; it does not introduce parallel roots or generic
catch-all directories.

## Canonical top-level domains

| Location | Responsibility |
| --- | --- |
| `apps/` | Independently runnable or deployable applications |
| `collection/` | Canonical Mycelium artwork, catalog, editorial and rendering pipeline |
| `contracts/` | Production Solidity, scoped by product domain |
| `deployments/` | Durable verified deployment records, never private journals |
| `docs/` | Durable public architecture, operations, security and release documentation |
| `infra/` | Hosting, routing, provisioning and provider configuration |
| `internal/` | Private plans, reports and retired material; excluded from public exports |
| `tests/` | Tests organized by the production domain and responsibility they protect |
| `tooling/` | Build, development, testing, release and verification programs |
| `verification/` | Immutable release-scoped source verification artifacts |
| `.github/` | Repository automation and explicitly gated CI/CD entrypoints |

Ordinary root files are project-wide entrypoints: package metadata, licensing,
security, contribution guidance and the repository overview. Generated and local
runtime directories such as `.dev/`, `node_modules/` and `output/` are ignored and
are not architectural domains.

## Current tree

```text
apps/web/                       browser application and public site config
collection/                     artwork, catalog, editorial and renderer source
contracts/core/                 deployed Solidity and generated contract source
deployments/core/ethereum/      canonical Ethereum deployment records
docs/apps/web/                  web architecture
docs/ARCHITECTURE.md            whole-system map and domain boundaries
docs/contracts/core/           contract architecture, operations and security
docs/collection/               generated collection content reference
docs/repository/               repository-wide release, security and structure docs
docs/readme-assets/            durable illustrations for the repository overview
infra/render/                   Render hosting configuration
internal/                       private development-only plans and evidence
tests/apps/web/                 web unit, protocol and integration tests
tests/collection/               collection tests
tests/contracts/core/           core protocol tests and fixtures
tests/release/                  repository-wide release and policy gates
tooling/build/                  deterministic builds and public site export
tooling/dev/                    local development lifecycle
tooling/release/                release preparation and controlled operations
tooling/testing/                browser, EVM and adversarial runners
tooling/verification/           read-only verification entrypoints
tooling/config/                 reviewed security-sensitive policies
tooling/lib/                    shared importable implementation
verification/core/releases/     immutable release capsules by digest
```

## Placement decision

Use the narrowest existing owner:

1. If code runs as part of the website, place it under `apps/web/`.
2. If it is a developer or release command, place it under the matching
   `tooling/` domain. Only reusable imports belong in `tooling/lib/`.
3. If it is a test, mirror the production owner under `tests/`; project-wide
   packaging and policy gates belong in `tests/release/`.
4. If it is hosting or provider configuration, place it under `infra/<provider>/`.
   An executable worker or API remains an application under `apps/`.
5. If it is durable documentation, place it in the matching `docs/` scope.
   Working plans and dated private evidence remain under `internal/`.

A feature, route or page inside the current website is not a new application. A
new `apps/<name>/` requires an independent runtime or deployment lifecycle. A new
`packages/` tree requires a real reusable package with at least two consumers and
an explicit workspace decision.

## Prohibited parallel structures

Do not create root-level `src/`, `scripts/`, `frontend/`, `assets/`, `config/`,
`shared/` or speculative `packages/`. Do not create empty future module, app or
provider directories. Future growth uses the existing domains:

| Component | Placement |
| --- | --- |
| Additional Solidity module | `contracts/modules/<name>/` |
| Independent API or worker | `apps/<name>/` |
| Second web product | `apps/<name>-web/` |
| Provider configuration | `infra/<provider>/` |
| Module verification capsule | `verification/modules/<name>/releases/<digest>/` |
| Module deployment record | `deployments/modules/<name>/ethereum/mainnet.json` |

These paths are created only when the component actually exists, never in
anticipation of possible future work.

## Naming conventions

- Directories and JavaScript/MJS files use lower-case kebab-case within their
  owning domain.
- Node tests use `<behavior>.test.mjs` and live under the domain they exercise.
- Durable reference documents use descriptive upper-case kebab-case names.
- Reviewed configuration uses descriptive environment/purpose names in the
  owning `config/` directory.
- Generated files keep generator-defined names and must not be renamed or edited
  independently of their generator and consumers.

## Documentation ownership

The root README introduces the project and provides a working local start.
`docs/README.md` is the documentation index, while `docs/ARCHITECTURE.md` maps
the complete system and its sources of truth. Domain READMEs explain what their
directory owns and how to work with it; detailed explanations and procedures
belong under the matching `docs/` domain.

Within `docs/contracts/core/`, `architecture/` explains contract behavior,
`operations/` contains operator procedures, `security/` preserves dated review
evidence and `decisions/` explains design constraints. This mirrors
`contracts/core/`: `core` names the current contract domain, not the whole
project. `docs/apps/web/` owns browser behavior; `docs/repository/` owns
cross-domain structure, release, export and dependency policies. The generated
content reference belongs in `docs/collection/` because its source is collection
content, not a contract operation.

Keep navigation useful by linking from the documentation index and the relevant
domain README. Prefer a clear heading and a cross-link over duplicating a rule or
creating a second page with the same purpose. Deployment records and verification
capsules remain in their dedicated evidence domains.

## Pre-creation approval

Repository structure is approved before it is created, not reviewed only after
implementation. Any task that would add a tracked file or directory, move or
rename a path, or change an ownership boundary must first present an exact proposed
tree for approval. The proposal identifies:

- every new or relocated path;
- the canonical domain that owns it;
- why an existing file or directory cannot carry the responsibility;
- affected tests, documentation, path consumers and public export policy.

Implementation starts only after explicit approval of that placement. Approval is
specific to the shown tree; general approval of a feature does not authorize an
unshown hierarchy. Editing existing files in their current approved locations does
not require repeated structure approval. If an implementation discovers that a new
path is needed, it pauses and presents the revised tree before creating it.

## Structural change gate

Adding a top-level domain or changing ownership boundaries requires a focused
architecture decision and explicit approval. The same change must update:

- this document and the root repository map;
- affected domain READMEs;
- every build, test, CI and runtime path consumer;
- `tooling/config/public-repository.json` when public inventory changes;
- architecture and reference tests.

The repository architecture test fails on an unexpected top-level directory.
`npm run check:references` fails on stale paths, unresolved local links and public
dependencies on `internal/`.
