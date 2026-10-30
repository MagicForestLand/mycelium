// Fault injection for the final allowlist audit. No RPC, keys or transactions.
// These assertions describe required safety properties, not the current behavior.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {fixture,deferred,buyer,other,genotype} from './check-allowlist-client.mjs'

for (const interruption of ['close', 'account', 'chain']) {
  test(`FINAL CHECK: ${interruption} during final nonce lookup prevents wallet submission`, async () => {
    const f = await fixture(), entered = deferred(), release = deferred()
    f.controls.nonce = async () => { entered.resolve(); await release.promise; return 7 }
    const attempt = f.api.reviewMint()
    await entered.promise
    if (interruption === 'close') f.api.close()
    if (interruption === 'account') f.api.onAccounts([other])
    if (interruption === 'chain') f.api.onChain('0x1')
    release.resolve()
    await attempt.catch(() => {})
    assert.equal(f.sent.length, 0, 'A stale/closed mint still requested a wallet transaction')
  })
}

test('FINAL CHECK: a still-pending wallet request cannot lose its durable context', async () => {
  const f = await fixture(), entered = deferred(), release = deferred()
  f.controls.send = async () => { entered.resolve(); await release.promise }
  const attempt = f.api.reviewMint()
  await entered.promise
  f.api.showPendingStatus()
  const reset = f.get('mintBody').children.find(child => child.textContent === 'I DID NOT APPROVE A TRANSACTION')
  if (reset) await reset.onclick()
  release.resolve()
  await attempt.catch(() => {})
  const pending = f.api.getState().pending
  assert.equal(pending?.buyer, buyer, 'Wallet returned a hash, but the buyer recovery context was lost')
  assert.deepEqual(Array.from(pending?.genotype || []), genotype)
})

test('FINAL CHECK: stale transaction replacement cannot clear a newer pending mint', async () => {
  const f = await fixture()
  let rejectWait
  f.controls.wait = () => new Promise((resolve, reject) => { rejectWait = reject })
  await f.api.reviewMint()
  const newHash = '0x' + 'd'.repeat(64)
  // The previous transaction was reconciled by polling, then a new mint started.
  f.api.setPending({hash:newHash,buyer,genotype,tokenId:'5',nonce:8})
  rejectWait(Object.assign(Error('Old transaction cancelled'), {code:'TRANSACTION_REPLACED',cancelled:true}))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.api.getState().pending?.hash, newHash, 'An old tx.wait rejection erased the new recovery intent')
})

test('FINAL CHECK: orphaned receipt overlay expires when canonical history catches up', async () => {
  const source = await readFile(new URL('../../apps/web/src/mycelium.js', import.meta.url), 'utf8')
  const start = source.indexOf('  const historyKey=s=>')
  const end = source.indexOf('    spiralEntries=[...indexed,', start)
  assert.ok(start >= 0 && end > start, 'Locate the production receipt reconciliation logic')
  // Use the real production changed-gate and pruning code, not a replacement.
  const reconcile = source.slice(start, end)
  const records = [{tokenId:'1',transactionHash:'0xold',owner:buyer,buyer,phase:'allowlist',price:'0',genotype}]
  const previous = {deployment:{id:'audit'},snapshot:{blockNumber:98,records}}
  const state = {deployment:{id:'audit'},snapshot:{blockNumber:102,records}}
  const receipts = new Map([['4',{tokenId:'4',blockNumber:100,genotype}]])
  const context = {previous,state,chainState:previous,receiptEntries:receipts,syncDocumentTitle(){},renderFooterNetworkLinks(){}}
  vm.runInNewContext(reconcile + '\n}', context)
  assert.equal(receipts.size, 0, 'A reorged-out NFT remains in My Friends despite the canonical head passing its receipt')
})

test('TRANSITION CHECK: receipt preview preserves public mint phase', async () => {
  const source = await readFile(new URL('../../apps/web/src/mycelium.js', import.meta.url), 'utf8')
  const start = source.indexOf('    const tokenId=String(record.tokenId),entry=')
  const end = source.indexOf('\n  },\n  markMinted:', start)
  assert.ok(start >= 0 && end > start, 'Locate production receipt insertion')
  const receipts = new Map()
  const context = {
    record:{tokenId:'5',genotype,phase:'public',price:'100000000000000',buyer,owner:buyer},
    receiptEntries:receipts,spiralEntries:[],mintedGenotypes:new Set(),genotypeKey:g=>g.join(','),currentView:'spiral',
    buildNodes(){},renderGallery(){},renderMyFriends(){},renderWishlist(){},renderHistoryCatalog(){},renderSidebar(){}
  }
  vm.runInNewContext(source.slice(start,end),context)
  assert.equal(receipts.get('5').phase,'public','Public NFT temporarily appears as an allowlist claim')
})
