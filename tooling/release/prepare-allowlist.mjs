import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Interface,getAddress,ZeroAddress} from 'ethers';

const abi=new Interface([
  'function setAllowlistAllocations(address[] wallets,uint256[] allocations)',
  'function startAllowlistSale()',
  'function openPublicSale()'
]);
export function allowlistPlan(config){
  const collection=getAddress(config.collection);
  assert.notEqual(collection,ZeroAddress,'Collection is required');
  assert.ok(Number.isSafeInteger(config.chainId)&&config.chainId>0,'Explicit chainId required');
  assert.ok(Number.isSafeInteger(config.saleCap)&&config.saleCap>0,'Explicit saleCap required');
  assert.equal(config.privatePriceETH,undefined,'privatePriceETH is obsolete; allowlist minting is always free');
  assert.equal(config.donors,undefined,'donors is obsolete; use allowlist');
  assert.ok(Array.isArray(config.allowlist)&&config.allowlist.length>0,'Allowlist required');
  const seen=new Set();
  const allowlist=config.allowlist.map(entry=>{
    const wallet=getAddress(typeof entry==='string'?entry:entry.wallet);
    const allocation=typeof entry==='string'?1:entry.allocation;
    assert.notEqual(wallet,ZeroAddress,'Zero allowlist wallet');
    assert.ok(!seen.has(wallet),'Duplicate allowlist wallet: '+wallet);seen.add(wallet);
    assert.ok(Number.isSafeInteger(allocation)&&allocation>=0&&allocation<=config.saleCap,'Invalid allocation');
    return {wallet,allocation};
  });
  const call=(method,args)=>({to:collection,value:'0',method,args,data:abi.encodeFunctionData(method,args)});
  const transactions=[];
  for(let i=0;i<allowlist.length;i+=100){
    const chunk=allowlist.slice(i,i+100);
    transactions.push(call('setAllowlistAllocations',[chunk.map(d=>d.wallet),chunk.map(d=>d.allocation)]));
  }
  const quotaTotal=allowlist.reduce((n,d)=>n+BigInt(d.allocation),0n);
  return {format:1,status:'PREPARED_NOT_SENT',chainId:config.chainId,collection,saleCap:config.saleCap,
    quotaTotal:quotaTotal.toString(),allowlist,
    warnings:[
      'Read deployed owner, saleCap, salePhase and allowlistClaimed before signing. These are absolute lifetime allocations; unlisted wallets keep their existing allocation.',
      'Execute configuration with the collection owner; verify receipts before announcing access. Calls are not atomic across batches.',
      ...(quotaTotal>BigInt(config.saleCap)?['Listed quotas exceed saleCap; the list is oversubscribed and does not guarantee everyone a mint.']:[])
    ],transactions,
    allowlistOpening:{warning:'Separate owner operation after configuration. This is the first transaction that enables primary minting.',transaction:call('startAllowlistSale',[])},
    publicOpening:{warning:'Separate irreversible owner operation after the allowlist phase. DO NOT include in the allocation setup batch.',transaction:call('openPublicSale',[])}};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);
  assert.ok(input&&output,'Usage: node tooling/release/prepare-allowlist.mjs allowlist.json calls.json');
  const plan=allowlistPlan(JSON.parse(await readFile(input,'utf8')));
  await writeFile(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  console.log(`Prepared ${plan.transactions.length} owner calls for ${plan.allowlist.length} wallets; allowlist minting is always free. No transactions sent.`);
}
