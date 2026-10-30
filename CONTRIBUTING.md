# Contributing

Mycelium Friends keeps development history in a private development repository and publishes reviewed release snapshots and material fixes. Public pull requests are welcome, but maintainers may reproduce a change in the development repository and publish it later instead of merging it directly.

## Questions, bugs and proposals

For an ordinary bug or project question, search the public repository's GitHub
Issues first and open a new issue if it has not been reported. Include the page,
release or commit involved; expected and actual behavior; minimal reproduction
steps; and the browser, wallet and network when relevant. Add screenshots or
logs only after removing wallet addresses, provider credentials and personal
information.

For a feature or structural proposal, explain the reader or operator problem
before proposing implementation. If it adds or moves tracked paths, show the
exact proposed tree and ownership boundary before writing the change. Security
reports never belong in Issues; use the private route in
[SECURITY.md](SECURITY.md).

Before proposing a change:

1. Use Node and npm versions pinned by `.node-version` and `packageManager`.
2. Install exactly from the lockfile with `npm ci`.
3. Follow the [repository structure and placement rules](docs/repository/REPOSITORY-STRUCTURE.md). Present and obtain approval for the exact proposed tree before adding or relocating tracked paths. Do not add a top-level directory or parallel source/tooling tree without an explicit architecture decision.
4. Keep generated sources reproducible; edit canonical collection/artwork/catalog inputs rather than generated output unless the generator itself is the subject of the change.
5. Run the tests relevant to the change and `npm test`. Contract, release, pricing, art or generator changes also require the full chain/catalog/release checks described in the [test guide](tests/README.md) and [release runbook](docs/repository/release/RELEASE.md).
6. Explain behavior, risk, tests and any generated-file changes in the pull request.

## Documentation changes

Write for the reader's task. Open with what the page explains or helps them do,
introduce unfamiliar terms once, and keep one idea per paragraph. Use a short
example where it makes an instruction easier to follow. Keep exact identifiers,
units and commands in code formatting.

Follow the [documentation index](docs/README.md) for naming and navigation. Keep
one authoritative explanation of each behavior and link to it from other pages.
Check technical claims against source and deployment records. Date observations
of mutable state, and distinguish a completed deployment from a planned action.
Give review scope and limitations alongside security findings.

Run commands from the repository root unless a page explicitly says otherwise.
Check prerequisites, output paths and expected results when editing a procedure.
Run `npm run check:references` after changing links. Generated collection copy
and immutable release artifacts follow their own source and review process.

Do not commit secrets, wallets, donor/allowlist address lists, local production configuration, deployment journals or signed transactions. Do not use a public issue for vulnerabilities; follow the [security policy](SECURITY.md).

Contributions do not authorize deployment, signing, sale activation or administration. Contract behavior changes require a new release digest, review evidence and deployment decision. Keep changes focused and do not silently rewrite release tags or evidence.

By contributing, you agree that your contribution is provided under the license applicable to its path as described in [LICENSING.md](LICENSING.md).
