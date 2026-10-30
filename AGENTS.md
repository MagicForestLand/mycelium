# Repository structure guardrails

The repository layout is an architectural boundary, not a suggestion. Preserve it
while implementing every task. Before adding or moving a file, consult
`README.md` and `docs/repository/REPOSITORY-STRUCTURE.md`.

## Canonical ownership

- `apps/`: independently runnable or deployable applications. A page or feature
  inside the website remains under `apps/web/`.
- `collection/`: canonical artwork, catalog, editorial and rendering inputs.
- `contracts/`: production Solidity, scoped by product domain.
- `deployments/`: durable verified deployment records only.
- `docs/`: durable public architecture, operations, security and release docs.
- `infra/`: hosting, routing and provider configuration; executable services stay
  under `apps/`.
- `internal/`: private plans, reports and retired material. It is not a secret
  store and public code must not depend on it.
- `tests/`: tests mirroring the production domain they protect.
- `tooling/`: build, development, testing, release and verification programs.
- `verification/`: immutable release-scoped verification artifacts.

## Placement rules

- Before creating any tracked file or directory, moving or renaming a path, or
  changing an ownership boundary, stop and present the proposed repository tree
  to the user. List every new or relocated path, its owning domain and why the
  existing hierarchy is insufficient. Do not make the structural change until
  the user explicitly approves that exact placement.
- Approval is task-specific. Approval of a feature or implementation plan is not
  approval of an unshown file hierarchy. If the user has already approved exact
  paths in the current task, do not request the same approval twice.
- Read-only inspection and edits to existing files in their current locations do
  not require a new structure approval. If implementation later reveals a need
  for an unapproved path, pause before creating it and present the revised tree.
- Do not create a new top-level directory without explicit user approval and an
  update to the repository structure policy and its tests.
- Do not create parallel top-level `src/`, `scripts/`, `frontend/`, `assets/`,
  `config/`, `shared/` or `packages/` trees.
- Put developer commands in the appropriate `tooling/` domain. Shared importable
  helpers belong in `tooling/lib/`; CLI entrypoints do not.
- Create a new `apps/<name>/` only for a component with an independent runtime or
  deployment lifecycle. Create `packages/` only with a real reusable package and
  at least two consumers.
- Do not create empty future directories or speculative provider directories.
- Keep generated output in its existing generated or ignored location. Edit the
  canonical source or generator rather than hand-editing generated files.
- Keep feature changes inside their owning domain. Do not opportunistically move,
  rename or reorganize unrelated files.

## Naming

- Use lower-case kebab-case for new directories and JavaScript/MJS files, following
  the convention of the owning directory.
- Name Node tests `<behavior>.test.mjs` under the matching `tests/` domain.
- Name durable reference documents with descriptive upper-case kebab-case names,
  such as `REPOSITORY-STRUCTURE.md`.
- Name reviewed configuration by environment and purpose inside the owning
  `config/` directory; do not create a generic root configuration directory.

## Structural change gate

Any intentional structural change must update all affected maps, path consumers,
export policies and tests in the same focused change. At minimum run:

```sh
node --test tests/release/repository-architecture.test.mjs
npm run check:references
```

For M1 and the public-launch work specifically:

- web runtime and UI: `apps/web/`;
- public site profiles: `apps/web/config/`;
- site build/export logic: `tooling/build/`;
- Render configuration: `infra/render/`;
- web behavior tests: `tests/apps/web/`;
- export, hosting and repository gates: `tests/release/`.
