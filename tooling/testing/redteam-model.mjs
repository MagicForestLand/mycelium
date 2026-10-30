import assert from 'node:assert/strict'
import ganache from 'ganache'
import {AbiCoder, BrowserProvider, ContractFactory, MaxUint256, keccak256, toBeHex, toUtf8Bytes} from 'ethers'
import {compileContracts} from '../lib/compile-contracts.mjs'
import {TRAIT_COUNTS, MAX_SUPPLY, traitsForGenotypeIndex} from '../../collection/source/token-id.js'

const STEP = 100_000_000_000_000n
const DOMAIN = keccak256(toUtf8Bytes('MyceliumFriends.PublicMint.v1'))
const coder = AbiCoder.defaultAbiCoder()
const configuredSeeds = (process.env.REDTEAM_SEEDS || '0x5eedc0de,0x1badb002').split(',').map(value => Number(BigInt(value.trim())) >>> 0)

function random(seed) {
  let value = seed >>> 0
  return () => ((value = (Math.imul(value, 1664525) + 1013904223) >>> 0) / 0x1_0000_0000)
}

function commitment(chainId, collection, buyer, selections, salt) {
  return keccak256(coder.encode(
    ['bytes32', 'uint256', 'address', 'address', 'uint256[6][]', 'bytes32'],
    [DOMAIN, chainId, collection, buyer, selections, salt]
  ))
}

function publicPrice(start, quantity) {
  const q = BigInt(quantity)
  return STEP * (q * start + q * (q - 1n) / 2n)
}

async function deploy(compiled, signer, file, name, args) {
  const artifact = compiled.contracts[file][name]
  const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args)
  await contract.waitForDeployment()
  return contract
}

async function runSeed(compiled, seed) {
  const local = ganache.provider({logging: {quiet: true}, chain: {chainId: 31337, hardfork: 'shanghai'}})
  const provider = new BrowserProvider(local, undefined, {cacheTimeout: -1})
  provider.pollingInterval = 10
  const trace = []
  try {
    const signers = await Promise.all([0, 1, 2, 3].map(index => provider.getSigner(index)))
    const addresses = await Promise.all(signers.map(signer => signer.getAddress()))
    const owner = signers[0]
    const descriptor = await deploy(compiled, owner, 'tests/contracts/core/fixtures/MintFixtures.sol', 'GenotypeCountsMock', [TRAIT_COUNTS, MAX_SUPPLY])
    const renderer = await deploy(compiled, owner, 'contracts/core/PhenotypeRenderer.sol', 'PhenotypeRenderer', [descriptor.target])
    const token = await deploy(compiled, owner, 'contracts/core/MyceliumFriends.sol', 'MyceliumFriends', [descriptor.target, renderer.target, addresses[0], addresses[0], 28, addresses[0]])
    const chainId = BigInt((await provider.getNetwork()).chainId)
    const rnd = random(seed)
    const model = {
      phase: 0, total: 0, allowlistMinted: 0, publicMinted: 0,
      allocations: new Map(addresses.map(address => [address.toLowerCase(), 0])),
      claimed: new Map(addresses.map(address => [address.toLowerCase(), 0])),
      genotypes: new Map(), owners: new Map()
    }
    const key = traits => traits.join(',')
    const owned = address => [...model.owners].filter(([, ownerAddress]) => ownerAddress === address.toLowerCase()).map(([id]) => id)
    const recordMint = (buyer, selections, isPublic) => {
      for (const traits of selections) {
        const id = ++model.total
        model.genotypes.set(key(traits), id)
        model.owners.set(id, buyer.toLowerCase())
      }
      if (isPublic) model.publicMinted += selections.length
      else {
        const who = buyer.toLowerCase()
        model.allowlistMinted += selections.length
        model.claimed.set(who, model.claimed.get(who) + selections.length)
      }
    }
    const compare = async label => {
      assert.equal(Number(await token.salePhase()), model.phase, `${label}: phase`)
      assert.equal(Number(await token.totalMinted()), model.total, `${label}: total`)
      assert.equal(Number(await token.allowlistMinted()), model.allowlistMinted, `${label}: allowlist counter`)
      assert.equal(Number(await token.publicMinted()), model.publicMinted, `${label}: public counter`)
      assert.ok(model.total <= 28, `${label}: cap`)
      for (const address of addresses) {
        const who = address.toLowerCase()
        assert.equal(Number(await token.allowlistAllocation(address)), model.allocations.get(who), `${label}: allocation ${who}`)
        assert.equal(Number(await token.allowlistClaimed(address)), model.claimed.get(who), `${label}: claimed ${who}`)
      }
      for (const [dna, id] of model.genotypes) {
        const traits = dna.split(',').map(Number)
        assert.equal(Number(await token.tokenForTraits(...traits)), id, `${label}: genotype ${dna}`)
        assert.equal((await token.ownerOf(id)).toLowerCase(), model.owners.get(id), `${label}: owner ${id}`)
      }
      if (model.total < 28) {
        const expected = model.phase === 2 || model.phase === 3 ? publicPrice(BigInt(model.publicMinted), 1) : 0n
        assert.equal(await token.mintPrice(1), expected, `${label}: next public price`)
      }
    }
    const step = async (label, action) => {
      trace.push(label)
      try { await action(); await compare(label) }
      catch (error) {
        error.message = `REDTEAM model divergence seed=0x${seed.toString(16)} operation=${trace.length - 1} ${label}\ntrace=${JSON.stringify(trace)}\n${error.message}`
        throw error
      }
    }
    const succeeds = async (promise, update) => { const tx = await promise; await tx.wait(); update?.() }
    const rejects = async promise => assert.rejects(() => promise)

    await step('owner allocates allowlist quotas', async () => {
      const values = [6, 5, 4]
      await succeeds(token.setAllowlistAllocations(addresses.slice(1), values), () => values.forEach((value, index) => model.allocations.set(addresses[index + 1].toLowerCase(), value)))
    })
    await step('owner starts allowlist', async () => succeeds(token.startAllowlistSale(), () => { model.phase = 1 }))

    let nextDna = 1000 + seed % 1000
    for (let index = 0; index < 22; index++) {
      const actorIndex = 1 + Math.floor(rnd() * 3), signer = signers[actorIndex], buyer = addresses[actorIndex], who = buyer.toLowerCase()
      const mode = Math.floor(rnd() * 6)
      if (mode === 0 || mode === 1) {
        const quantity = mode === 0 ? 1 : 1 + Math.floor(rnd() * 3)
        const selections = Array.from({length: quantity}, () => traitsForGenotypeIndex(nextDna++))
        if (mode === 1 && index % 5 === 0 && selections.length > 1) selections[1] = selections[0]
        const unique = new Set(selections.map(key)).size === selections.length && selections.every(traits => !model.genotypes.has(key(traits)))
        const allowed = model.claimed.get(who) + quantity <= model.allocations.get(who) && model.total + quantity <= 28 && unique
        await step(`allowlist ${mode ? 'batch' : 'single'} actor=${actorIndex} q=${quantity} expected=${allowed}`, async () => {
          const call = mode === 0 ? token.connect(signer).mint(...selections[0]) : token.connect(signer).mintBatch(selections)
          if (allowed) await succeeds(call, () => recordMint(buyer, selections, false)); else await rejects(call)
        })
      } else if (mode === 2) {
        const value = Math.floor(rnd() * 7)
        await step(`allocation edit actor=${actorIndex} value=${value}`, async () => succeeds(token.setAllowlistAllocations([buyer], [value]), () => model.allocations.set(who, value)))
      } else if (mode === 3) {
        const ids = owned(buyer)
        await step(`transfer actor=${actorIndex} owned=${ids.length}`, async () => {
          if (!ids.length) return
          const id = ids[Math.floor(rnd() * ids.length)], recipient = addresses[1 + actorIndex % 3]
          await succeeds(token.connect(signer).transferFrom(buyer, recipient, id), () => model.owners.set(id, recipient.toLowerCase()))
        })
      } else if (mode === 4) {
        await step(`unauthorized allocation actor=${actorIndex}`, async () => rejects(token.connect(signer).setAllowlistAllocations([buyer], [28])))
      } else {
        const traits = traitsForGenotypeIndex(nextDna++)
        await step(`allowlist nonzero payment actor=${actorIndex}`, async () => rejects(token.connect(signer).mint(...traits, {value: 1n})))
      }
    }

    await step('irreversible transition to public', async () => succeeds(token.openPublicSale(), () => { model.phase = 2 }))
    await step('allowlist cannot reopen', async () => rejects(token.startAllowlistSale()))
    await step('allocations freeze after public', async () => rejects(token.setAllowlistAllocations([addresses[1]], [28])))

    for (let index = 0; index < 20 && model.total < 28; index++) {
      const actorIndex = 1 + Math.floor(rnd() * 3), signer = signers[actorIndex], buyer = addresses[actorIndex]
      const mode = index % 7
      const traits = mode === 5 && model.genotypes.size ? [...model.genotypes.keys()][0].split(',').map(Number) : traitsForGenotypeIndex(nextDna++)
      const selections = [traits]
      const salt = toBeHex(BigInt(seed) * 1000n + BigInt(index + 1), 32)
      const hash = commitment(chainId, token.target, buyer, selections, salt)
      await step(`public commit actor=${actorIndex} mode=${mode}`, async () => succeeds(token.connect(signer).commit(hash)))
      if (mode === 0) {
        await step(`early reveal actor=${actorIndex}`, async () => rejects(token.connect(signer).revealMint(selections, salt, MaxUint256, MaxUint256, {value: MaxUint256})))
        await local.request({method: 'evm_increaseTime', params: [60]}); await local.request({method: 'evm_mine', params: []})
      } else if (mode === 1) {
        await step(`wrong buyer reveal actor=${actorIndex}`, async () => rejects(token.connect(signers[1 + actorIndex % 3]).revealMint(selections, salt, 0, MaxUint256)))
        await local.request({method: 'evm_increaseTime', params: [60]}); await local.request({method: 'evm_mine', params: []})
      } else if (mode === 2) {
        await local.request({method: 'evm_increaseTime', params: [60]}); await local.request({method: 'evm_mine', params: []})
        await step(`wrong salt reveal actor=${actorIndex}`, async () => rejects(token.connect(signer).revealMint(selections, toBeHex(999999n, 32), 0, MaxUint256)))
      } else if (mode === 3) {
        await local.request({method: 'evm_increaseTime', params: [86400]}); await local.request({method: 'evm_mine', params: []})
        const expected = publicPrice(BigInt(model.publicMinted), 1)
        await step(`expired reveal actor=${actorIndex}`, async () => rejects(token.connect(signer).revealMint(selections, salt, expected, MaxUint256, {value: expected})))
        await step(`expired commitment replacement actor=${actorIndex}`, async () => succeeds(token.connect(signer).commit(hash)))
        await local.request({method: 'evm_increaseTime', params: [60]}); await local.request({method: 'evm_mine', params: []})
      } else {
        await local.request({method: 'evm_increaseTime', params: [60]}); await local.request({method: 'evm_mine', params: []})
      }
      const actual = publicPrice(BigInt(model.publicMinted), 1)
      if (mode === 4) {
        await step(`wrong payment actor=${actorIndex}`, async () => rejects(token.connect(signer).revealMint(selections, salt, actual + 1n, MaxUint256, {value: actual})))
        continue
      }
      const available = !model.genotypes.has(key(traits)) && model.total < 28
      await step(`mature reveal actor=${actorIndex} available=${available}`, async () => {
        const call = token.connect(signer).revealMint(selections, salt, actual, MaxUint256, {value: actual})
        if (available) await succeeds(call, () => recordMint(buyer, selections, true)); else await rejects(call)
      })
      if (available) await step(`replay reveal actor=${actorIndex}`, async () => rejects(token.connect(signer).revealMint(selections, salt, actual, MaxUint256, {value: actual})))
      if (index === 8) {
        await step('owner pauses public', async () => succeeds(token.pausePublicSale(), () => { model.phase = 3 }))
        await step('commit blocked while paused', async () => rejects(token.connect(signer).commit(toBeHex(42n, 32))))
        await step('owner resumes public', async () => succeeds(token.resumePublicSale(), () => { model.phase = 2 }))
      }
    }
    console.log(`PASS reference model seed=0x${seed.toString(16)} operations=${trace.length} total=${model.total} private=${model.allowlistMinted} public=${model.publicMinted}`)
    return {seed: `0x${seed.toString(16)}`, operations: trace.length, total: model.total}
  } finally {
    provider.destroy()
    await local.disconnect()
  }
}

console.log('RUN red-team differential model against production MyceliumFriends')
const {compiled} = compileContracts()
const results = []
for (const seed of configuredSeeds) results.push(await runSeed(compiled, seed))
console.log(JSON.stringify({status: 'PASS', results}))
