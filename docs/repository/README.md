# Repository and release documentation

This section governs the repository as a whole: where work belongs, how public
snapshots are selected, how a production release is approved and what dated
dependency evidence accompanies it. It does not define contract behavior or the
browser experience.

## Contents

- [Repository structure](REPOSITORY-STRUCTURE.md) — ownership boundaries,
  naming and placement rules
- [Production release runbook](release/RELEASE.md) — candidate binding,
  approval, signing, deployment and post-deployment checks
- [Public export profiles](release/PUBLIC-REPOSITORY-EXPORT.md) — the minimal
  verification capsule and later full-project snapshot
- [Dependency security review](security/DEPENDENCY-REVIEW.md) — a dated audit
  snapshot and its limitations

Product documentation remains with its production owner:

- contracts: [`docs/contracts/core/`](../contracts/core/README.md);
- web application: [`docs/apps/web/`](../apps/web/ARCHITECTURE.md);
- collection content: [`docs/collection/`](../collection/COLLECTION-CONTENT.md).

For the relationships between these domains, see the
[system architecture](../ARCHITECTURE.md).
