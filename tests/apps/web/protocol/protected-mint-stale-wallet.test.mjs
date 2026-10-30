import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {IntentStore, createIntent} from '../../../../apps/web/src/mint-protection.js'
import {ProtectedMintFlow} from '../../../../apps/web/src/protected-mint-flow.js'

const counts = [32, 128, 32, 16, 4, 32]
const buyer = '0x2222222222222222222222222222222222222222'
const other = '0x3333333333333333333333333333333333333333'
const collection = '0x1111111111111111111111111111111111111111'
const transactionHash = '0x' + '45'.repeat(32)

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return {promise, resolve}
}

function fixture(phase) {
  const domain = {
    chainId: 31337,
    collection,
    buyer,
    deploymentHash: '0x' + 'ab'.repeat(32),
    codeHash: '0x' + 'cd'.repeat(32)
  }
  const values = new Map()
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  }
  const store = new IntentStore(storage, domain, counts)
  const record = store.save(createIntent(domain, [[0, 0, 0, 0, 0, 0]], counts, {rng: webcrypto}))
  const provider = {}
  const context = {account: buyer, chainId: domain.chainId, provider, open: true}
  const nonceEntered = deferred()
  const releaseNonce = deferred()
  const walletRequests = []

  const request = Object.assign(async (...args) => {
    walletRequests.push({phase, args})
    return {hash: transactionHash, nonce: 7}
  }, {
    staticCall: async () => phase === 'reveal' ? [1n] : undefined,
    estimateGas: async () => 100_000n
  })
  const writable = {
    runner: {
      getNonce: async () => {
        nonceEntered.resolve()
        await releaseNonce.promise
        return 7
      }
    },
    commit: phase === 'commit' ? request : undefined,
    revealMint: phase === 'reveal' ? request : undefined
  }
  const flow = new ProtectedMintFlow({
    deployment: {address: collection},
    provider,
    store,
    record,
    getSigner: async () => ({}),
    locks: {request: async (key, options, run) => run({name: key})},
    isCurrent: () => context.open && context.account === buyer && context.chainId === domain.chainId && context.provider === provider
  })
  flow.head = async () => ({number: 25, timestamp: 1_000})
  flow.writable = async () => writable

  let start
  if (phase === 'commit') {
    flow.sync = async () => ({state: 'missing', head: {number: 25, timestamp: 1_000}})
    flow.contract = {salePhase: async () => 2n}
    start = () => flow.sendCommit()
  } else {
    flow.sync = async () => ({state: 'ready', head: {number: 25, timestamp: 1_000}})
    flow.contract = {salePhase: async () => 2n, mintPrice: async () => 0n}
    const quote = {
      hash: record.hash,
      price: 0n,
      maximum: 0n,
      buffer: 0,
      quantity: 1,
      deadline: 1_600,
      block: 25,
      remaining: 999n
    }
    flow.quote = quote
    start = () => flow.sendReveal(quote)
  }

  return {context, nonceEntered, releaseNonce, walletRequests, start}
}

const interruptions = {
  account: context => { context.account = other },
  chain: context => { context.chainId = 1 },
  'provider context': context => { context.provider = {} },
  'flow close': context => { context.open = false }
}

for (const phase of ['commit', 'reveal']) {
  for (const [interruption, interrupt] of Object.entries(interruptions)) {
    test(`PUBLIC ${phase}: ${interruption} during final nonce lookup prevents a stale wallet request`, async () => {
      const race = fixture(phase)
      const attempt = race.start()
      await race.nonceEntered.promise
      interrupt(race.context)
      race.releaseNonce.resolve()
      await attempt.catch(() => {})
      assert.equal(
        race.walletRequests.length,
        0,
        `A stale ${phase} operation still requested a wallet transaction after ${interruption}`
      )
    })
  }
}
