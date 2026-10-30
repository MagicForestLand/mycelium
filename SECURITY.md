# Security policy

## Supported source

For the immutable NFT core, supported source means the verified Ethereum
mainnet deployment at `0x49f3A83a8EE0B1BB4334c5Fa997565926234648F`, its
`mycelium-friends-core-v1.0.0` source tag and the matching
[deployment record](deployments/core/ethereum/mainnet.json). For the website,
supported source means the latest commit on the public repository's `main`
branch that produced the release deployed at
[mycelium.magicforest.land](https://mycelium.magicforest.land/).

Development branches, historical Sepolia deployments, local artifacts, older
frontend snapshots and untagged contract candidates are not supported
production releases.

## Reporting a vulnerability

Use GitHub's private **Report a vulnerability** form in the public repository
Security tab. Do not disclose a suspected vulnerability in a public issue, pull
request, discussion, social post or blockchain transaction.

The repository remains private until the sales launch. Immediately after its
visibility changes to public—and before sales open or the repository is
announced—an administrator must enable private vulnerability reporting and
verify the form from a non-admin account. If the form is unavailable, the
launch gate has failed: restore private visibility or publish a monitored
private contact here before proceeding. Never ask a reporter to post security
details publicly.

Include the affected release tag/commit, contract or frontend address where relevant, impact, reproduction steps, and whether exploitation has been observed. Never send seed phrases, private keys, raw signed transactions or unnecessary personal information.

We will acknowledge a report through the same private channel, reproduce and classify it, and coordinate remediation and disclosure. No response or bounty timeframe is promised. On-chain immutability may limit contract remediation; pausing the website does not pause a contract.

## Scope and claims

The repository uses deterministic tests, static analysis and AI-assisted review. These are not a professional independent security audit and do not guarantee the absence of vulnerabilities. Third-party wallets, RPC providers, marketplaces, Render, Reown, GitHub, Ethereum itself and user devices are outside the repository's direct control.
