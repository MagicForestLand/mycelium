// Independent adversarial allowlist checks. In-memory EVM only, no RPC or keys.
// Uses the actual production collection, without the public commit/reveal wrapper.
// Art is a counts-only fixture, so this does not test rendering or metadata.
import assert from 'node:assert/strict'
import {BrowserProvider, ContractFactory, ZeroAddress} from 'ethers'
import ganache from 'ganache'
import {compileContracts} from '../lib/compile-contracts.mjs'
import {TRAIT_COUNTS, MAX_SUPPLY, traitsForGenotypeIndex as selection} from '../../collection/source/token-id.js'

const {compiled} = compileContracts()
const local = ganache.provider({logging: {quiet: true}, chain: {hardfork: 'shanghai'}})
let checks = 0
const pass = message => { checks++; console.log(`PASS ${checks}: ${message}`) }
const send = async promise => (await promise).wait()
try {
  const provider = new BrowserProvider(local)
  provider.pollingInterval = 10
  const owner = await provider.getSigner(0), buyer = await provider.getSigner(1)
  const alice = await owner.getAddress(), bob = await buyer.getAddress()
  async function deploy(file, name, args) {
    const artifact = compiled.contracts[file][name]
    const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, owner).deploy(...args)
    await contract.waitForDeployment()
    return contract
  }
  const descriptor = await deploy('tests/contracts/core/fixtures/MintFixtures.sol', 'GenotypeCountsMock', [TRAIT_COUNTS, MAX_SUPPLY])
  const renderer = await deploy('contracts/core/PhenotypeRenderer.sol', 'PhenotypeRenderer', [await descriptor.getAddress()])
  const fresh = cap => deploy('contracts/core/MyceliumFriends.sol', 'MyceliumFriends', [descriptor.target, renderer.target, alice, alice, cap, alice])
  const nft = await fresh(100)
  const reject = (action, name) => assert.rejects(action, error => {
    assert.equal(nft.interface.parseError(error.data)?.name, name)
    return true
  })
  const revertedTransaction = action => assert.rejects(async () => send(action()), error => error.receipt?.status === 0)
  await send(nft.setAllowlistAllocations([alice, bob], [40, 40]))
  await send(nft.startAllowlistSale())

  // Failure at the last element must roll back every prior allocation update.
  await revertedTransaction(() => nft.setAllowlistAllocations([alice, ZeroAddress], [1, 1], {gasLimit: 250000}))
  assert.equal(await nft.allowlistAllocation(alice), 40n)
  pass('Invalid final allocation update rolls back earlier updates')

  const batch = Array.from({length: 32}, (_, i) => selection(i))
  await reject(() => nft.mintBatch.staticCall([...batch, selection(32)]), 'InvalidQuantity')
  await reject(() => nft.mintBatch.staticCall([...batch.slice(0, 31), selection(0)]), 'CombinationAlreadyMinted')
  for (let layer = 0; layer < 6; layer++) {
    const invalid = selection(300)
    invalid[layer] = TRAIT_COUNTS[layer]
    await reject(() => nft.mint.staticCall(...invalid), 'InvalidTrait')
  }
  pass('Batch size, final duplicate and all six trait upper bounds are enforced')

  await send(nft.mintBatch(batch, {gasLimit: 10000000}))
  assert.equal(await nft.totalMinted(), 32n)
  assert.equal(await nft.allowlistClaimed(alice), 32n)
  for (let i = 0; i < 32; i++) {
    assert.equal(await nft.ownerOf(i + 1), alice)
    const packed = await nft.genotypeOf(i + 1)
    assert.deepEqual(Array.from({length: 6}, (_, layer) => Number((packed >> BigInt(layer * 8)) & 255n)), batch[i])
  }
  pass('Maximum batch creates exactly 32 unique NFTs and consumes 32 claims')

  await send(nft.setAllowlistAllocations([alice], [31]))
  await reject(() => nft.mint.staticCall(...selection(32)), 'AllowlistAllocationExceeded')
  assert.equal(await nft.allowlistClaimed(alice), 32n)
  await send(nft.setAllowlistAllocations([alice], [33]))
  await send(nft.mint(...selection(32)))
  await reject(() => nft.mint.staticCall(...selection(33)), 'AllowlistAllocationExceeded')
  pass('Allocation can legitimately fall below lifetime claims, restoring it grants only the difference')

  await send(nft.transferFrom(alice, bob, 1))
  assert.equal(await nft.allowlistClaimed(alice), 33n)
  assert.equal(await nft.allowlistClaimed(bob), 0n)
  await reject(() => nft.mint.staticCall(...selection(33)), 'AllowlistAllocationExceeded')
  await reject(() => nft.connect(buyer).transferFrom.staticCall(alice, bob, 2), 'ERC721InsufficientApproval')
  pass('Transfers neither replenish nor consume claims and do not authorize transfers of other tokens')

  // Both callers see availability before one wins. No promise of mempool priority.
  await send(nft.setAllowlistAllocations([alice], [34]))
  assert.equal(await nft.mint.staticCall(...selection(33)), 34n)
  assert.equal(await nft.connect(buyer).mint.staticCall(...selection(33)), 34n)
  await send(nft.connect(buyer).mint(...selection(33)))
  await revertedTransaction(() => nft.mint(...selection(33), {gasLimit: 400000}))
  assert.equal(await nft.ownerOf(34), bob)
  assert.equal(await nft.allowlistClaimed(alice), 33n)
  assert.equal(await nft.allowlistClaimed(bob), 1n)
  pass('Competing eligible buyer can win a genotype, loser reverts without consuming a claim')

  const receiver = await deploy('tests/contracts/core/fixtures/PhaseOneFixtures.sol', 'BatchReceiverFixture', [nft.target])
  const callbackBatch = Array.from({length: 32}, (_, i) => selection(100 + i))
  // The caller is eligible, but the receiving contract is not. tx.origin must not grant quota.
  await revertedTransaction(() => receiver.run([selection(100)], 0, ZeroAddress, {gasLimit: 500000}))
  assert.equal(await nft.allowlistClaimed(alice), 33n)
  await send(nft.setAllowlistAllocations([receiver.target], [32]))
  await revertedTransaction(() => receiver.run(callbackBatch, 32, ZeroAddress, {gasLimit: 15000000}))
  assert.equal(await nft.totalMinted(), 34n)
  assert.equal(await nft.allowlistClaimed(receiver.target), 0n)
  assert.equal(await receiver.callbacks(), 0n)
  for (let i = 0; i < 32; i++) {
    assert.equal(await nft.isAvailable(...callbackBatch[i]), true)
    assert.equal(await nft.ownershipEpoch(35 + i), 0n)
  }
  pass('Unlisted contract cannot borrow caller quota, rejection in callback 32 rolls back the entire batch')

  await send(receiver.run(callbackBatch, 0, bob, {gasLimit: 15000000}))
  assert.equal(await receiver.reentryBlocked(), true)
  assert.equal(await receiver.callbacks(), 32n)
  assert.equal(await nft.allowlistClaimed(receiver.target), 32n)
  assert.equal(await nft.totalMinted(), 66n)
  assert.equal(await nft.allowlistMinted(), 66n)
  assert.equal(await nft.publicMinted(), 0n)
  for (let i = 35; i <= 66; i++) assert.equal(await nft.ownerOf(i), bob)
  pass('All 32 callbacks block reentrancy, forwarded NFTs preserve receiver claims and supply accounting')

  const limited = await fresh(2)
  await send(limited.setAllowlistAllocations([alice, bob], [2, 2]))
  await send(limited.startAllowlistSale())
  await send(limited.mint(...selection(0)))
  await revertedTransaction(() => limited.connect(buyer).mintBatch([selection(1), selection(2)], {gasLimit: 1000000}))
  assert.equal(await limited.totalMinted(), 1n)
  assert.equal(await limited.allowlistClaimed(bob), 0n)
  assert.equal(await limited.isAvailable(...selection(1)), true)
  await send(limited.connect(buyer).mint(...selection(1)))
  await reject(() => limited.mint.staticCall(...selection(2)), 'SoldOut')
  pass('Oversubscribed allocations cannot exceed sale cap, an oversized final batch cannot mint partially')

  await send(nft.transferOwnership(bob))
  assert.equal(await nft.owner(), alice)
  await reject(() => nft.connect(buyer).setAllowlistAllocations.staticCall([bob], [100]), 'OwnableUnauthorizedAccount')
  await send(nft.connect(buyer).acceptOwnership())
  assert.equal(await nft.owner(), bob)
  await reject(() => nft.setAllowlistAllocations.staticCall([alice], [100]), 'OwnableUnauthorizedAccount')
  await reject(() => nft.connect(buyer).pausePublicSale.staticCall(), 'InvalidSalePhase')
  assert.equal(await nft.salePhase(), 1n)
  pass('Admin transfer requires acceptance, former admin loses privileges, public pause cannot stop allowlist')
  console.log(`PASS allowlist adversarial checks: ${checks} groups`)
} finally {
  await local.disconnect()
}
