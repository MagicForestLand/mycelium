import test from 'node:test'
import assert from 'node:assert/strict'
import {ChainReader} from '../../../../apps/web/src/chain-reader.js'

const deployment = {
  id: 'redteam-local', label: 'Red-team local', networkName: 'Local',
  mintProtocol: 'commit-reveal-v1', saleLifecycle: 'phased-v1', chainId: 31337,
  address: '0x1111111111111111111111111111111111111111', rpcUrl: 'http://127.0.0.1:8545',
  deploymentBlock: 1, deploymentHash: '0x' + '11'.repeat(32), codeHash: '0x' + '22'.repeat(32),
  catalogHash: '33'.repeat(32)
}

function storage() {
  const values = new Map()
  return {
    get length() { return values.size },
    key(index) { return [...values.keys()][index] ?? null },
    getItem(key) { return values.get(key) ?? null },
    setItem(key, value) { values.set(key, value) },
    removeItem(key) { values.delete(key) }
  }
}

function fixture(overrides = {}) {
  const activeDeployment = {...deployment, ...overrides}
  const reader = new ChainReader(activeDeployment, activeDeployment.catalogHash, storage())
  reader.verify = async () => {}
  const controls = {head: 2, fail: null, delay: null, total: 0, calls: {head: 0, logs: 0}}
  reader.provider.destroy()
  reader.provider = {
    async getBlockNumber() {
      controls.calls.head++
      if (controls.delay) await controls.delay
      if (controls.fail) throw controls.fail
      return controls.head
    },
    async getBlock(number) { return {hash: '0x' + Number(number).toString(16).padStart(64, '0')} },
    async getLogs() { controls.calls.logs++; return [] }
  }
  reader.contract = {
    totalMinted: async () => BigInt(controls.total), saleCap: async () => 100n,
    publicMinted: async () => 0n, allowlistMinted: async () => 0n, salePhase: async () => 1n
  }
  return {reader, controls}
}

test('controlled load coalesces simultaneous readers into one canonical refresh', async () => {
  const {reader, controls} = fixture()
  let release
  controls.delay = new Promise(resolve => { release = resolve })
  const requests = Array.from({length: 128}, () => reader.refresh())
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(controls.calls.head, 1)
  release()
  const snapshots = await Promise.all(requests)
  assert.equal(new Set(snapshots).size, 1)
  assert.equal(controls.calls.logs, 0)
  assert.equal(snapshots[0].total, 0)
})

test('fresh history stays within 1000-block RPC limits and applies concurrent chunks in order', async () => {
  const {reader, controls} = fixture()
  controls.head = 8000
  reader.snapshot = {records:[],publicOpen:false,blockNumber:0,blockHash:'0x'+'0'.repeat(64)}
  const ranges = [], progress = []
  let active = 0, maxActive = 0
  reader.provider.getLogs = async filter => {
    const from = Number(filter.fromBlock), to = Number(filter.toBlock)
    ranges.push([from, to])
    assert.ok(to - from + 1 <= 1000)
    active++
    maxActive = Math.max(maxActive, active)
    await new Promise(resolve => setTimeout(resolve, Math.max(0, 7 - Math.floor((from - 1) / 1000))))
    active--
    return []
  }
  const snapshot = await reader.refresh((current, end) => progress.push([current, end]))
  assert.equal(snapshot.total, 0)
  assert.equal(ranges.length, 8)
  assert.equal(maxActive, 6)
  assert.deepEqual(ranges, Array.from({length: 8}, (_, index) => [index * 1000 + 1, (index + 1) * 1000]))
  assert.deepEqual(progress, Array.from({length: 8}, (_, index) => [(index + 1) * 1000, 8000]))
})

test('zero supply skips an arbitrarily long empty deployment history', async () => {
  const {reader, controls} = fixture()
  controls.head = 5_000_000
  const snapshot = await reader.refresh()
  assert.equal(snapshot.total, 0)
  assert.equal(snapshot.blockNumber, 5_000_000)
  assert.equal(controls.calls.logs, 0)
})

test('cold public readers require the verified API snapshot instead of archive RPC logs', async () => {
  const {reader, controls} = fixture({chainId: 1, rpcUrl: 'https://rpc.example'})
  controls.total = 1
  await assert.rejects(() => reader.refresh(), /verified collection snapshot/)
  assert.equal(controls.calls.logs, 0)
})

for (const [name, error] of [
  ['RPC 429', Object.assign(Error('rate limited'), {status: 429})],
  ['RPC timeout', Object.assign(Error('timeout'), {code: 'TIMEOUT'})],
  ['temporary offline', Object.assign(Error('offline'), {code: 'NETWORK_ERROR'})]
]) {
  test(`${name} is unavailable, never a confirmed empty snapshot, and recovers`, async () => {
    const {reader, controls} = fixture()
    controls.fail = error
    const outcomes = await Promise.allSettled(Array.from({length: 32}, () => reader.refresh()))
    assert.ok(outcomes.every(result => result.status === 'rejected'))
    assert.equal(reader.snapshot, null)
    assert.equal(controls.calls.head, 1)
    controls.fail = null
    const recovered = await reader.refresh()
    assert.equal(recovered.total, 0)
    assert.equal(reader.snapshot, recovered)
  })
}

test('malformed/internally inconsistent RPC history is rejected rather than cached as truth', async () => {
  const {reader, controls} = fixture()
  controls.total = 1
  await assert.rejects(() => reader.refresh(), /history changed during sync/)
  assert.equal(reader.snapshot, null)
  controls.total = 0
  const recovered = await reader.refresh()
  assert.equal(recovered.total, 0)
})
