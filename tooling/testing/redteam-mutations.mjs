import assert from 'node:assert/strict'
import {cp, mkdir, mkdtemp, readFile, symlink, writeFile} from 'node:fs/promises'
import {spawnSync} from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import ganache from 'ganache'
import {BrowserProvider, ContractFactory, MaxUint256, toBeHex} from 'ethers'
import {compileContracts, projectRoot} from '../lib/compile-contracts.mjs'
import {TRAIT_COUNTS, MAX_SUPPLY, traitsForGenotypeIndex} from '../../collection/source/token-id.js'

const production = await readFile(new URL('../../contracts/core/MyceliumFriends.sol', import.meta.url), 'utf8')
const results = []

async function deploy(compiled, signer, file, name, args, options) {
  const artifact = compiled.contracts[file][name]
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args, options || {})
  await contract.waitForDeployment()
  return contract
}

async function runContractProbe(source, probe) {
  let local, provider, stage = 'local EVM startup'
  try {
    local = ganache.provider({logging: {quiet: true}, chain: {chainId: 31337, hardfork: 'shanghai'}})
    provider = new BrowserProvider(local, undefined, {cacheTimeout: -1})
    stage = 'compilation'
    const {compiled} = source === production
      ? compileContracts()
      : compileContracts({sourceOverrides: {'contracts/core/MyceliumFriends.sol': source}})
    stage = 'deployment'
    const owner = await provider.getSigner(0), attacker = await provider.getSigner(1)
    const ownerAddress = await owner.getAddress(), attackerAddress = await attacker.getAddress()
    const descriptor = await deploy(compiled, owner, 'tests/contracts/core/fixtures/MintFixtures.sol', 'GenotypeCountsMock', [TRAIT_COUNTS, MAX_SUPPLY])
    const renderer = await deploy(compiled, owner, 'contracts/core/PhenotypeRenderer.sol', 'PhenotypeRenderer', [descriptor.target])
    const token = await deploy(compiled, owner, 'contracts/core/MyceliumFriends.sol', 'MyceliumFriends', [descriptor.target, renderer.target, ownerAddress, ownerAddress, 8, ownerAddress])
    stage = 'probe'
    const violation = await probe({token, owner, attacker, ownerAddress, attackerAddress, local, provider, compiled, deploy})
    if (typeof violation !== 'boolean') throw Error('probe did not return a boolean result')
    return {violation}
  } catch (error) {
    return {error, stage}
  } finally {
    provider?.destroy()
    if (local) await local.disconnect()
  }
}

async function contractMutation(name, from, to, probe) {
  assert.ok(production.includes(from), `${name}: mutation anchor is stale`)
  const mutated = production.replace(from, to)
  assert.notEqual(mutated, production, `${name}: mutation did not apply`)
  const baseline = await runContractProbe(production, probe)
  if (baseline.error) {
    const detail = `production baseline ${baseline.stage} error: ${baseline.error.shortMessage || baseline.error.message}`.split('\n')[0]
    results.push({name, class: 'contract', status: 'ERROR', baseline: 'ERROR', detail})
    console.log(`ERROR ${name} · production baseline ${baseline.stage}`)
    return
  }
  if (baseline.violation) {
    results.push({name, class: 'contract', status: 'BASELINE_FAIL', baseline: 'FAIL', detail: 'production baseline produced the forbidden transition'})
    console.log(`BASELINE_FAIL ${name}`)
    return
  }

  const mutant = await runContractProbe(mutated, probe)
  if (mutant.error) {
    const detail = `mutant ${mutant.stage} error: ${mutant.error.shortMessage || mutant.error.message}`.split('\n')[0]
    results.push({name, class: 'contract', status: 'ERROR', baseline: 'PASS', detail})
    console.log(`ERROR ${name} · mutant ${mutant.stage}`)
    return
  }
  const killed = mutant.violation
  results.push({name, class: 'contract', status: killed ? 'KILLED' : 'SURVIVED', baseline: 'PASS', detail: killed ? 'mutant ran and the probe observed the forbidden state transition' : 'mutant ran without the expected forbidden transition'})
  console.log(`${killed ? 'KILLED' : 'SURVIVED'} ${name}`)
}

const tx = async promise => (await promise).wait()
const g = index => traitsForGenotypeIndex(index)
const publicReady = async ({token}) => { await tx(token.startAllowlistSale()); await tx(token.openPublicSale()) }
const mature = async local => { await local.request({method: 'evm_increaseTime', params: [60]}); await local.request({method: 'evm_mine', params: []}) }

await contractMutation('genotype uniqueness',
  'if (existing != 0) revert CombinationAlreadyMinted(existing);',
  'if (false) revert CombinationAlreadyMinted(existing);',
  async ({token, ownerAddress}) => {
    await tx(token.setAllowlistAllocations([ownerAddress], [2])); await tx(token.startAllowlistSale()); await tx(token.mint(...g(10)))
    try { await tx(token.mint(...g(10))); return true } catch { return false }
  })

await contractMutation('allowlist lifetime quota',
  'if (claimed > allowlistAllocation[msg.sender]) revert AllowlistAllocationExceeded();',
  'if (false) revert AllowlistAllocationExceeded();',
  async ({token, ownerAddress}) => {
    await tx(token.setAllowlistAllocations([ownerAddress], [1])); await tx(token.startAllowlistSale()); await tx(token.mint(...g(11)))
    try { await tx(token.mint(...g(12))); return (await token.allowlistClaimed(ownerAddress)) === 2n } catch { return false }
  })

await contractMutation('sale cap',
  'if (quantity > saleCap - totalMinted) revert SoldOut();',
  'if (false) revert SoldOut();',
  async ({token, ownerAddress, local}) => {
    await tx(token.setAllowlistAllocations([ownerAddress], [8])); await tx(token.startAllowlistSale())
    for (let index = 0; index < 8; index++) await tx(token.mint(...g(20 + index)))
    await tx(token.openPublicSale())
    const selections = [g(29)], salt = toBeHex(29, 32), hash = await token.makeCommitment(ownerAddress, selections, salt)
    await tx(token.commit(hash)); await mature(local)
    try { await tx(token.revealMint(selections, salt, 0, MaxUint256)); return (await token.totalMinted()) > 8n } catch { return false }
  })

await contractMutation('allowlist exact payment',
  'if (msg.value != required) revert IncorrectPayment(required, msg.value);',
  'if (false) revert IncorrectPayment(required, msg.value);',
  async ({token, ownerAddress}) => {
    await tx(token.setAllowlistAllocations([ownerAddress], [1])); await tx(token.startAllowlistSale())
    try { await tx(token.mint(...g(30), {value: 1n})); return true } catch { return false }
  })

await contractMutation('commitment minimum age',
  'timestamp == 0 || block.timestamp < timestamp + MIN_COMMITMENT_AGE',
  'timestamp == 0 || false',
  async context => {
    await publicReady(context); const selections = [g(40)], salt = toBeHex(40, 32), hash = await context.token.makeCommitment(context.ownerAddress, selections, salt)
    await tx(context.token.commit(hash))
    try { await tx(context.token.revealMint(selections, salt, 0, MaxUint256)); return true } catch { return false }
  })

await contractMutation('commitment expiry',
  'if (block.timestamp >= timestamp + MAX_COMMITMENT_AGE) revert CommitmentExpired();',
  'if (false) revert CommitmentExpired();',
  async context => {
    await publicReady(context); const selections = [g(41)], salt = toBeHex(41, 32), hash = await context.token.makeCommitment(context.ownerAddress, selections, salt)
    await tx(context.token.commit(hash)); await context.local.request({method: 'evm_increaseTime', params: [86400]}); await context.local.request({method: 'evm_mine', params: []})
    try { await tx(context.token.revealMint(selections, salt, 0, MaxUint256)); return true } catch { return false }
  })

await contractMutation('commitment buyer binding',
  'bytes32 commitment = makeCommitment(msg.sender, selections, salt);\n        uint256 timestamp = commitments[msg.sender][commitment];',
  'bytes32 commitment = makeCommitment(owner(), selections, salt);\n        uint256 timestamp = commitments[owner()][commitment];',
  async context => {
    await publicReady(context); const selections = [g(42)], salt = toBeHex(42, 32), hash = await context.token.makeCommitment(context.ownerAddress, selections, salt)
    await tx(context.token.commit(hash)); await mature(context.local)
    try { await tx(context.token.connect(context.attacker).revealMint(selections, salt, 0, MaxUint256)); return (await context.token.ownerOf(1)).toLowerCase() === context.attackerAddress.toLowerCase() } catch { return false }
  })

await contractMutation('commitment replay consumption',
  'delete commitments[msg.sender][commitment];',
  '// mutation: commitment left live',
  async context => {
    await publicReady(context); const selections = [g(43)], salt = toBeHex(43, 32), hash = await context.token.makeCommitment(context.ownerAddress, selections, salt)
    await tx(context.token.commit(hash)); await mature(context.local); await tx(context.token.revealMint(selections, salt, 0, MaxUint256))
    return (await context.token.commitments(context.ownerAddress, hash)) !== 0n
  })

await contractMutation('public chronological price source',
  'MintPricing.price(publicMinted, quantity)',
  'MintPricing.price(allowlistMinted, quantity)',
  async ({token, ownerAddress}) => {
    await tx(token.setAllowlistAllocations([ownerAddress], [1])); await tx(token.startAllowlistSale()); await tx(token.mint(...g(44))); await tx(token.openPublicSale())
    return (await token.mintPrice(1)) !== 0n
  })

await contractMutation('owner-only allocation administration',
  'external onlyOwner nonReentrant {',
  'external nonReentrant {',
  async ({token, attacker, attackerAddress}) => {
    try { await tx(token.connect(attacker).setAllowlistAllocations([attackerAddress], [8])); return (await token.allowlistAllocation(attackerAddress)) === 8n } catch { return false }
  })

async function frontendMutation(name, file, from, to, testFile, expectedFailure) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mycelium-mutation-'))
  for(const source of ['collection','apps'])await cp(path.join(projectRoot,source),path.join(dir,source),{recursive:true})
  await cp(path.join(projectRoot, testFile), path.join(dir, testFile), {recursive: true})
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}\n')
  await symlink(path.join(projectRoot, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
  const target = path.join(dir, file), source = await readFile(target, 'utf8')
  assert.ok(source.includes(from), `${name}: mutation anchor is stale`)
  await writeFile(target, source.replace(from, to))
  const run = spawnSync(process.execPath, ['--test', testFile], {cwd: dir, encoding: 'utf8'})
  const killed = run.status !== 0 && `${run.stdout}\n${run.stderr}`.includes(expectedFailure)
  results.push({name, class: 'frontend', status: killed ? 'KILLED' : 'SURVIVED', detail: killed ? 'behavioral regression test failed on mutant' : 'mutant escaped the named regression'})
  console.log(`${killed ? 'KILLED' : 'SURVIVED'} ${name}`)
}

await frontendMutation('PUBLIC final isCurrent guard', 'apps/web/src/protected-mint-flow.js', '    this.assertCurrent();\n', '', 'tests/apps/web/protocol/protected-mint-stale-wallet.test.mjs', 'A stale')
await frontendMutation('snapshot canonical block binding', 'apps/web/src/chain-reader.js', "    if(!block||!same(block.hash,snapshot.blockHash))throw Error('Snapshot API block is not canonical.');\n", "    if(!block)throw Error('Snapshot API block is not canonical.');\n", 'tests/apps/web/protocol/chain-client.test.mjs', 'Missing expected rejection')
await frontendMutation('RPC unavailable ownership truthfulness', 'apps/web/src/mycelium.js', 'if(!chainState.snapshot){', 'if(false){', 'tests/apps/web/integration/ownership-truthfulness.test.mjs', 'Unknown ownership')

async function staleWaitMutation() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mycelium-wait-mutation-'))
  for(const source of ['collection','apps'])await cp(path.join(projectRoot,source),path.join(dir,source),{recursive:true})
  await mkdir(path.join(dir, 'tooling/testing'), {recursive: true})
  for (const file of ['check-allowlist-client.mjs', 'check-allowlist-final-client.mjs']) await cp(path.join(projectRoot, 'tooling/testing', file), path.join(dir, 'tooling/testing', file))
  await writeFile(path.join(dir, 'package.json'), '{"type":"module"}\n')
  await symlink(path.join(projectRoot, 'node_modules'), path.join(dir, 'node_modules'), 'dir')
  const target = path.join(dir, 'apps/web/src/chain-ui.js'), source = await readFile(target, 'utf8')
  const clearGuard = "function clearPending(target=pending){if(target&&!isCurrentPending(target))return false;"
  const callbackGuard = "if(!isCurrentPending(attempt)||pending.hash!==sentHash)return;"
  assert.ok(source.includes(clearGuard) && source.includes(callbackGuard), 'stale tx.wait mutation anchor is stale')
  await writeFile(target, source.replace(clearGuard, "function clearPending(target=pending){").replace(callbackGuard, 'if(false)return;'))
  const run = spawnSync(process.execPath, ['--test', 'tooling/testing/check-allowlist-final-client.mjs'], {cwd: dir, encoding: 'utf8'})
  const output = `${run.stdout}\n${run.stderr}`
  const killed = run.status !== 0 && /stale transaction replacement|newer pending mint|older mint attempt/i.test(output)
  results.push({name: 'stale tx.wait callback isolation', class: 'frontend', status: killed ? 'KILLED' : 'SURVIVED', detail: killed ? 'behavioral replacement regression failed on mutant' : 'mutant escaped replacement regression'})
  console.log(`${killed ? 'KILLED' : 'SURVIVED'} stale tx.wait callback isolation`)
}
await staleWaitMutation()

const killed = results.filter(result => result.status === 'KILLED').length
const contractResults = results.filter(result => result.class === 'contract')
const baselinePassed = contractResults.filter(result => result.baseline === 'PASS').length
const passed = killed === results.length
console.log(JSON.stringify({status: passed ? 'PASS' : 'FAIL', score: `${killed}/${results.length}`, baselineProbes: `${baselinePassed}/${contractResults.length}`, results}, null, 2))
if (!passed) process.exitCode = 1
