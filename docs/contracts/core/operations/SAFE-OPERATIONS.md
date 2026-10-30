# Safe administration and treasury

Selected production Safe on Ethereum mainnet:

`0x61942881D7ED31aE8935De4d454820d4214443f8`

The verified production deployment used this address for three roles:

- `initialOwner`;
- immutable `treasury`;
- initial `royaltyReceiver`.

The deployer is a separate EOA whose address/control is confirmed on a hardware wallet. It may be a separate account on an existing Ledger; purchasing another device is not a launch gate. Completing the CREATE deployment graph does not grant the deployer collection administration rights.

## Recorded pre-deployment configuration

The recorded read-only check through two independent Ethereum RPCs at block `26250552` (`0x1908d38`) returned matching results. This is historical evidence, not a claim about the current live state:

- Safe `1.5.0`, singleton `0xFf51A5898e281Db6DfC7855790607438dF2ca44b`;
- owner `0x6290cFe6B58Da21eF6408dD15C45D2a3eE938C6D`;
- threshold `1/1`, nonce `0`;
- no modules; guard and module guard are zero;
- fallback handler `0x3EfCBb83A4A7AfcB4F68D501E2c2203a38be77f4`.

`1/1` was the selected initial configuration: one signer can authorize a Safe
transaction. It does not provide the independent approvals of a threshold such
as `2-of-3`. Any later signer or threshold change needs its own reviewed
transaction and read-back evidence.

The exact deployment-time policy is in `tooling/config/mainnet-safe-policy.json`. Identity/security invariants (Safe, implementation, code hashes, modules, guards and fallback handler) are separated from `preDeployState` (the NGO owner, threshold and expected nonce). `npm run release:verify-safe` checks this pre-deployment stage read-only, without transactions or gas expenditure. After the first actual Safe transaction, that nonce becomes historical evidence rather than a permanent invariant.

## Organizational control and signer changes

The collection contract points to the Safe address, not to any individual Safe
owner. The Safe's owner list and threshold are mutable operational security
settings. Changing only those settings leaves the Safe address, collection
owner address and immutable treasury unchanged.

Company registration, organizational records or connecting a hardware wallet
do not prove an on-chain signer change. The historical snapshot above is not a
claim about the Safe's current owners. Always verify the live configuration
on-chain.

For any signer change within the existing Safe:

1. Read the current owners, threshold, nonce, modules and guards from mainnet.
2. Verify the intended replacement address on its Ledger screen and compare it
   independently with the proposed Safe transaction and organizational record.
3. Review and authorize the signer change through the current Safe owners.
   The Safe address, collection owner address and immutable treasury stay the
   same when only the Safe's signers change.
4. After confirmation, read `getOwners()`, the threshold and nonce again and
   preserve the result as new evidence.
5. Use the first required administrative call, such as final allowlist setup,
   to demonstrate control. Read back the allocations and sale phase before
   separately authorizing minting.

Connecting a Ledger to MetaMask or the Safe UI does not change authority. The
authorized signer change must be executed on-chain. These technical control
steps do not replace organizational records of who controls the wallet.

## Reviewing signer protection

If treasury assets or the economic value of administrative access grow materially, a separate decision can:

- add independent Ledger owners;
- move to a threshold such as `2-of-3`;
- verify the new configuration and preserve its current on-chain evidence.

Record any adopted configuration and its verification separately from the
original deployment policy. Recovery phrases are never transferred, imported
into MetaMask or stored in the repository.

## Read-only verification

```sh
RPC_URL=https://FIRST_INDEPENDENT_RPC npm run release:verify-safe -- tooling/config/mainnet-safe-policy.json
RPC_URL=https://SECOND_INDEPENDENT_RPC npm run release:verify-safe -- tooling/config/mainnet-safe-policy.json
```

Deployment-time policy records the pre-deployment state. After any authorized
owner or nonce change, retain the original report as historical deployment
evidence and preserve the new on-chain read-back in the operational archive.
Do not rewrite the frozen source tag or deployment record.
