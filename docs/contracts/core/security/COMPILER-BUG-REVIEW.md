# Solidity compiler bug review

Original review: 2026-10-22 against the Solidity project's official
[`bugs.json`](https://github.com/ethereum/solidity/blob/develop/docs/bugs.json) and
[`bugs_by_version.json`](https://github.com/ethereum/solidity/blob/develop/docs/bugs_by_version.json).
Release-status clarification: 2026-10-29. This page records the deployed
compiler configuration; it is not a recommendation to use the same version for
an unrelated new deployment.

Release compiler decision:

- solc npm package: `0.8.37` (the deployed release pin)
- optimizer: enabled, 200 runs
- Yul optimizer: disabled
- pipeline: legacy EVM code generation (`viaIR: false`)
- EVM target: `shanghai`

The exact settings live in `tooling/lib/compile-contracts.mjs` and are bound into the production manifest. The full regression and gas report must be rerun after any compiler or settings change.

## Bugs reported for the previous solc 0.8.30

| UID | Severity | Applicability to production source | Resolution |
| --- | --- | --- | --- |
| SOL-2026-7 `YulOptimizerKnowledgeBaseStaleBookkeeping` | low | The previous optimizer configuration enabled Yul optimization and production/imported sources contain inline assembly. A source-only exclusion would not be strong enough because the advisory also includes compiler-generated Yul utilities under legacy codegen. | Upgrade to 0.8.37 and set `optimizer.details.yul = false`. Do not re-enable before moving to a stable compiler containing the fix and repeating the full regression. |
| SOL-2026-6 `MisorderedNamedParametersInRequireWithCustomErrors` | very low | Requires `viaIR: true`; release settings use `false`. | Not applicable under pinned settings; fixed in 0.8.37 as defense in depth. |
| SOL-2026-5 `MemoryByteArrayElementDeleteClearsWholeWord` | low/medium | Requires legacy codegen and `delete` on one element of a memory `bytes` array. The compiled production import graph contains no such operation. Storage deletes such as `_pendingOwner` and commitments are unrelated. | Fixed in 0.8.37. |
| SOL-2026-4 `SpillSlotCollisionAcrossMutualRecursion` | low/medium | Requires `viaIR: true` and mutual recursion. | Not applicable; fixed in 0.8.37. |
| SOL-2026-3 `InheritanceOrderReversalOnStorageEndWarning` | medium | Requires the custom storage-layout warning near the end of the storage address space. Production sources do not specify such a layout and compilation emits no such warning. | Fixed before 0.8.37. |
| SOL-2026-2 `UnsoundSpillInMutualRecursion` | medium | Requires `viaIR: true` and intersecting mutually recursive call cycles. | Not applicable; fixed before 0.8.37. |
| SOL-2026-1 `TransientStorageClearingHelperCollision` | high | Requires `viaIR: true`, Cancun-or-later output, and clearing both transient and persistent storage. The release uses legacy codegen, Shanghai and no transient storage. | Not applicable; fixed before 0.8.37. |
| SOL-2025-1 `LostStorageArrayWriteOnSlotOverflow` | low | Requires an array straddling the end of the 256-bit storage address space. Production sources use the normal compiler-assigned storage region and no custom near-end layout. | Fixed before 0.8.37. |

## Subsequent compiler release

Solidity [0.8.38 was released on 2026-10-22](https://www.soliditylang.org/blog/2026/10/22/solidity-0.8.38-release-announcement/)
with a fix for SOL-2026-7, which affects versions 0.8.19–0.8.37. The earlier
description of 0.8.38 as unreleased is superseded by that announcement.

The deployed release remains bound to 0.8.37 with the affected Yul optimizer
disabled. Updating documentation or a compiler package cannot change deployed
bytecode. A future compiler migration requires a new candidate: inspect the
known bugs for its exact settings, compare storage layout, ABI, bytecode and gas,
and repeat the release tests before approval.
