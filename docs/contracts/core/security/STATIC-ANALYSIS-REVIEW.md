# Solidity static-analysis review

Review date: **2026-10-22**. This review applies to production Solidity sources compiled with solc `0.8.37`, optimizer runs `200`, Yul optimizer disabled, legacy pipeline, and `shanghai` EVM target.

## Reproducible invocation

The analysis used the official Slither `0.11.6` package and an official native solc `0.8.37` installed by `solc-select 1.2.0`. The generated input contains all production imports and no test fixtures. The extra `sourceMap` outputs are required by Slither and do not change compiler semantics.

```sh
npm run verify:solidity-input -- /external/mycelium-static-analysis-input.json
uvx --from slither-analyzer==0.11.6 slither \
  /external/mycelium-static-analysis-input.json \
  --compile-force-framework solc-json \
  --solc /path/to/native/solc-0.8.37 \
  --exclude-dependencies \
  --json /external/mycelium-slither-0.11.6.json \
  --disable-color
```

Slither analyzed 62 contracts with 102 detectors and emitted 85 raw results. The non-zero process exit is expected when findings exist; it is not by itself a failed compilation. Source and report paths remain outside the release repository.

## High findings

### `incorrect-exp` — OpenZeppelin `Math.mulDiv`

Classification: **false positive / dependency**. Slither interprets `(3 * denominator) ^ 2` as a mistaken exponent. In Solidity this is intentionally bitwise XOR, used as the modular-inverse seed in OpenZeppelin Contracts `5.4.0`. The release compiles the pinned dependency with solc `0.8.37`; it does not copy or modify this routine.

### `incorrect-shift` — `PairBase64.encode`

Classification: **false positive**. Slither's rendered expression loses the Yul call structure. The source computes:

```text
not(sub(shl(8 * (32 - remaining), 1), 1))
```

for `remaining` in `1..5`, which retains exactly the high input bytes and clears dirty trailing memory. The independent oracle suite compares output with Node and OpenZeppelin for RFC vectors, all 4096 lookup pairs in every position, lengths `0..99`, word boundaries, dirty padding, and a 50 KB input. The full chain run passed this suite.

## Medium findings

### `divide-before-multiply`

Classification: **intentional integer arithmetic**.

- `PairBase64` uses the standard padded Base64 length formula and a floor to locate complete six-byte groups.
- `BeadCodec` consumes validated four-byte runs and sizes its upper-bound buffer per complete run.
- `PhenotypeRenderer` rounds dynamic ABI regions up to 32-byte boundaries; the subsequent exact-size checks reject malformed returndata.
- Remaining instances are in the pinned OpenZeppelin math implementation.

Boundary, malformed-input, exact-byte and large-input tests cover these paths.

### `uninitialized-local` — `BubbleText`

Classification: **false positive**. Solidity local value types and memory references begin at zero. Empty `bytes`, row `0`, and column `0` are the intended accumulators. UTF-8 tests cover Cyrillic/emoji, three-by-24 scalar limits, malformed/overlong encodings, surrogates, controls, XML noncharacters, and escaping.

## Low findings

- `calls-loop`: constructor loops are bounded by six banks; metadata loops by fixed page/layer counts; mint loops by `MAX_BATCH = 32`. A configured external transfer validator is intentionally called for every token and may atomically block a transfer or batch.
- `reentrancy-events`: refund occurs only after mint accounting and NFT receiver callbacks, inside `revealMint`'s `nonReentrant` guard. `MintRefunded` is emitted only after a successful nonzero refund; `Minted` is emitted earlier during accounting. A failed refund reverts the entire transaction, including both state changes and logs. Rejecting, out-of-gas and reentrant recipients are tested.
- `timestamp`: timestamps enforce an explicit quote deadline and the documented 60-second/86400-second commitment windows; they are not used for randomness or price calculation. Exact boundary and pause/expiry cases are tested.
- `missing-zero-check`: the finding is OpenZeppelin `Ownable2Step.transferOwnership`. A zero pending owner cancels an unfinished transfer; zero cannot call `acceptOwnership`. Mycelium separately disables `renounceOwnership`.

## Informational findings

Assembly, pragma ranges, inherited dead code, generated constructor complexity, low-level ETH calls, long generated literals, and the external Creator Token interface event were reviewed. They describe deliberate implementation/dependency structure and do not identify an additional release change. Compiler-bug applicability is tracked separately in [COMPILER-BUG-REVIEW.md](COMPILER-BUG-REVIEW.md).

## Disposition

No production contract change is required from this run. No detector was globally suppressed, and the raw report remains available as external release evidence. Static analysis supplements rather than replaces the contract, differential, mutation, browser, fork, and manual independent reviews.

Tool sources: [Slither releases](https://github.com/crytic/slither/releases), [slither-analyzer on PyPI](https://pypi.org/project/slither-analyzer/), [solc-select on PyPI](https://pypi.org/project/solc-select/).
