import {spawnSync} from 'node:child_process'

const commands = [
  [process.execPath, ['--test',
    'tooling/testing/check-allowlist-client.mjs',
    'tests/apps/web/protocol/chain-reader-chaos.test.mjs',
    'tests/apps/web/protocol/mint-protection.test.mjs',
    'tests/apps/web/integration/ownership-truthfulness.test.mjs',
    'tests/apps/web/protocol/protected-mint-flow.test.mjs',
    'tests/apps/web/protocol/protected-mint-stale-wallet.test.mjs',
    'tests/release/secret-containment.test.mjs'
  ]],
  [process.execPath, ['tooling/testing/redteam-contract.mjs']],
  [process.execPath, ['tooling/testing/redteam-model.mjs']],
  [process.execPath, ['tooling/testing/redteam-mutations.mjs']]
]

for (const [command, args] of commands) {
  console.log(`\nREDTEAM ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {stdio: 'inherit', env: process.env})
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
console.log('\nPASS pre-mainnet red-team suite')
