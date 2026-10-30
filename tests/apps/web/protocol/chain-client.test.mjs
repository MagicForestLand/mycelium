import test from 'node:test';
import assert from 'node:assert/strict';
import {ZeroAddress} from 'ethers';
import {CHAIN_SNAPSHOT_FORMAT,allowlistMessage,appendMintLogs,chainInterface,deploymentKey,friendlyError,mintReceiptToken,mintReceiptTokenId,mintReceiptForGenotype,mintReceiptPayment,tokenExplorerURL,validateDeployment} from '../../../../apps/web/src/chain-core.js';
import {ChainReader,fetchAndSeedSnapshot,snapshotFromEnvelope,validateChainSnapshot} from '../../../../apps/web/src/chain-reader.js';
const buyer='0x1111111111111111111111111111111111111111',address='0x2222222222222222222222222222222222222222';
test('allowlist allowance copy covers waiting, remaining, complete and ineligible wallets',()=>{
  assert.equal(allowlistMessage(0,0),'This wallet has no allowlist mints.');
  assert.equal(allowlistMessage(1,0),'One allowlist myFriend is waiting for this wallet.');
  assert.equal(allowlistMessage(3,0),'3 allowlist myFriends are waiting for this wallet.');
  assert.equal(allowlistMessage(3,2),'One allowlist mint remains · 2 of 3 myFriends have found a home.');
  assert.equal(allowlistMessage(1,1),'Allowlist complete · 1 of 1 myFriend has found a home.');
  assert.equal(allowlistMessage(0,1),'This wallet has no allowlist mints. 1 myFriend was claimed before its allocation changed.');
  assert.equal(allowlistMessage(1,2),'Allowlist complete · 2 myFriends have found a home. This wallet’s current allocation is 1.');
});
test('allowlist receipts use assigned DNA and actual ID, including batch and wrong-source rejection',()=>{
  const receipt={status:1,logs:[log('GenotypeAssigned',[2,1n]),log('Transfer',[ZeroAddress,buyer,2],1),log('GenotypeAssigned',[3,2n],2),log('Transfer',[ZeroAddress,buyer,3],3)]};
  assert.equal(mintReceiptForGenotype(receipt,address,buyer,[1,0,0,0,0,0]),2n);
  assert.equal(mintReceiptForGenotype(receipt,address,buyer,[2,0,0,0,0,0]),3n);
  assert.equal(mintReceiptForGenotype(receipt,address,buyer,[3,0,0,0,0,0]),null);
  assert.equal(mintReceiptForGenotype({...receipt,logs:receipt.logs.map(l=>({...l,address:buyer}))},address,buyer,[1,0,0,0,0,0]),null);
  assert.equal(mintReceiptForGenotype({...receipt,logs:receipt.logs.slice(1)},address,buyer,[1,0,0,0,0,0]),null);
  assert.equal(mintReceiptForGenotype(receipt,address,address,[1,0,0,0,0,0]),null);
  assert.throws(()=>mintReceiptForGenotype({...receipt,status:0},address,buyer,[1,0,0,0,0,0]),/reverted/);
});
function log(name,args,index=0,hash='0xabc') {return {...chainInterface.encodeEventLog(chainInterface.getEvent(name),args),blockNumber:10,index,transactionHash:hash,address};}
test('primary mint index preserves mint order and pricing while tracking current ownership',()=>{
  const logs=[log('Minted',[buyer,1,2,0],0),log('GenotypeAssigned',[1,0x0201n],1),log('Transfer',[ZeroAddress,buyer,1],2),
    log('GenotypeAssigned',[2,0x0403n],3),log('Transfer',[ZeroAddress,buyer,2],4),log('Transfer',[buyer,address,1],5),
    log('PublicSaleOpened',[2],6),log('Minted',[buyer,3,2,100_000_000_000_000n],7),log('GenotypeAssigned',[3,0x0605n],8),
    log('Transfer',[ZeroAddress,buyer,3],9),log('GenotypeAssigned',[4,0x0807n],10),log('Transfer',[ZeroAddress,buyer,4],11)];
  const state=appendMintLogs({records:[],publicOpen:false},logs.reverse());
  assert.deepEqual(state.records.map(r=>r.tokenId),['1','2','3','4']);
  assert.deepEqual(state.records.map(r=>r.genotype.slice(0,2)),[[1,2],[3,4],[5,6],[7,8]]);
  assert.deepEqual(state.records.map(r=>r.price),['0','0','0','100000000000000']);
  assert.deepEqual(state.records.map(r=>r.phase),['allowlist','allowlist','public','public']);
  assert.deepEqual(state.records.map(r=>r.owner),[address,buyer,buyer,buyer]);
  const next=appendMintLogs(state,[log('Minted',[buyer,5,1,200000000000000n]),log('GenotypeAssigned',[5,0x0a09n],1),log('Transfer',[ZeroAddress,buyer,5],2)]);
  assert.equal(next.records.at(-1).price,'200000000000000');
});
test('index refuses gaps, incomplete event ranges and unpaired transfers',()=>{
  const empty={records:[],publicOpen:false};
  assert.throws(()=>appendMintLogs(empty,[log('Minted',[buyer,2,1,0])]),/gap/);
  assert.throws(()=>appendMintLogs(empty,[log('Minted',[buyer,1,1,0])]),/Incomplete/);
  assert.throws(()=>appendMintLogs(empty,[log('Transfer',[ZeroAddress,buyer,1])]),/Unmatched/);
});
test('receipt success requires the exact collection, recipient, token and successful status',()=>{
  const receipt={status:1,logs:[log('Transfer',[ZeroAddress,buyer,1])]};
  assert.equal(mintReceiptToken(receipt,address,buyer,1),true);
  assert.equal(mintReceiptTokenId(receipt,address,buyer),1n);
  assert.equal(mintReceiptToken(receipt,buyer,buyer,1),false);
  assert.equal(mintReceiptToken(receipt,address,address,1),false);
  assert.equal(mintReceiptToken(receipt,address,buyer,2),false);
  assert.throws(()=>mintReceiptToken({...receipt,status:0},address,buyer,0),/reverted/);
});
test('receipt payment uses the exact collection, buyer and minted range',()=>{
  const receipt={status:1,logs:[log('Minted',[buyer,4,2,150n]) ]};
  assert.deepEqual(mintReceiptPayment(receipt,address,buyer,4),{paid:150n,quantity:2n});
  assert.deepEqual(mintReceiptPayment(receipt,address,buyer,5),{paid:150n,quantity:2n});
  assert.equal(mintReceiptPayment(receipt,address,buyer,6),null);
  assert.equal(mintReceiptPayment(receipt,address,address,4),null);
  assert.equal(mintReceiptPayment({...receipt,logs:receipt.logs.map(entry=>({...entry,address:buyer}))},address,buyer,4),null);
});
test('deployment identity isolates chain, collection and local resets; public RPC requires HTTPS',()=>{
  const d={id:'local-free-v1',label:'Local free',networkName:'myFriends Local',mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:31337,address,rpcUrl:'http://127.0.0.1:8545',deploymentBlock:1,deploymentHash:'0x'+'a'.repeat(64),codeHash:'0x'+'b'.repeat(64),catalogHash:'c'.repeat(64)};
  assert.equal(validateDeployment(d),d);
  assert.notEqual(deploymentKey(d),deploymentKey({...d,deploymentHash:'0x'+'d'.repeat(64)}));
  assert.notEqual(deploymentKey(d),deploymentKey({...d,address:buyer}));
  assert.throws(()=>validateDeployment({...d,chainId:1}),/HTTPS/);
  assert.throws(()=>validateDeployment({...d,address:ZeroAddress}),/Invalid/);
  assert.throws(()=>validateDeployment({...d,mintProtocol:'legacy-direct'}),/current protected mint protocol/);
  assert.throws(()=>validateDeployment({...d,saleLifecycle:undefined}),/current phased sale lifecycle/);
});
test('token explorer links use the native NFT item route',()=>{
  assert.equal(tokenExplorerURL({explorerUrl:'https://sepolia.etherscan.io',address},3),`https://sepolia.etherscan.io/nft/${address}/3`);
  assert.equal(tokenExplorerURL({explorerUrl:'https://eth.blockscout.com/',address},3),`https://eth.blockscout.com/token/${address}/instance/3`);
});
test('cache tolerates inaccessible storage, malformed JSON and invalid token IDs without breaking startup',()=>{
  const d={id:'local-cache',label:'Local',networkName:'Local',mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:31337,address,rpcUrl:'http://127.0.0.1:8545',deploymentBlock:1,deploymentHash:'0x'+'a'.repeat(64),codeHash:'0x'+'b'.repeat(64),catalogHash:'c'.repeat(64)};
  for(const storage of [null,{getItem(){throw Error('Storage denied');}},{getItem:()=>'{broken'},{getItem:()=>JSON.stringify({version:1,records:[{tokenId:'9999999999999999999999999999999999999999'}]})}]){
    const reader=new ChainReader(d,d.catalogHash,storage,1000);assert.equal(reader.snapshot,null);reader.destroy();
  }
  assert.throws(()=>new ChainReader(d,'d'.repeat(64),null),/different artwork catalog/);
});
test('remote snapshot is accepted only for the exact deployment and a coherent mint history',()=>{
  const d={id:'remote-cache',label:'Remote',networkName:'Sepolia',mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:11155111,address,rpcUrl:'https://rpc.example',snapshotUrl:'https://cache.example/api/mycelium/snapshot',deploymentBlock:10,deploymentHash:'0x'+'a'.repeat(64),codeHash:'0x'+'b'.repeat(64),catalogHash:'c'.repeat(64)};
  const snapshot={format:CHAIN_SNAPSHOT_FORMAT,records:[{tokenId:'1',genotype:[1,2,3,4,0,1],price:'0',phase:'allowlist',step:0,buyer,owner:buyer,transactionHash:'0x'+'d'.repeat(64),blockNumber:11},{tokenId:'2',genotype:[2,3,4,5,1,0],price:'0',phase:'public',step:1,buyer,owner:buyer,transactionHash:'0x'+'e'.repeat(64),blockNumber:12}],publicOpen:true,salePhase:2,total:2,cap:1000,publicMinted:1,allowlistMinted:1,price:'100000000000000',blockNumber:12,blockHash:'0x'+'f'.repeat(64),updatedAt:1};
  const envelope={format:CHAIN_SNAPSHOT_FORMAT,deployment:{id:d.id,chainId:d.chainId,address:d.address,deploymentBlock:d.deploymentBlock,deploymentHash:d.deploymentHash,codeHash:d.codeHash,catalogHash:d.catalogHash},snapshot};
  assert.equal(snapshotFromEnvelope(envelope,d,1000,[32,128,32,16,4,32]),snapshot);
  for(const changed of [{chainId:1},{address:buyer},{deploymentHash:'0x'+'0'.repeat(64)},{codeHash:'0x'+'0'.repeat(64)},{catalogHash:'0'.repeat(64)}])assert.throws(()=>snapshotFromEnvelope({...envelope,deployment:{...envelope.deployment,...changed}},d,1000,[32,128,32,16,4,32]),/does not match/);
  for(const changed of [{total:1},{publicMinted:2},{price:'0'},{blockHash:'broken'},{records:[snapshot.records[1],snapshot.records[0]]}])assert.throws(()=>validateChainSnapshot({...snapshot,...changed},d,1000,[32,128,32,16,4,32]),/Invalid|match/);
  assert.throws(()=>validateChainSnapshot({...snapshot,records:snapshot.records.map((record,index)=>({...record,genotype:index?[1,2,3,4,0,1]:record.genotype}))},d,1000,[32,128,32,16,4,32]),/Duplicate/);
});
test('remote snapshot seeds empty storage but never replaces a newer local snapshot',()=>{
  const d={id:'remote-seed',label:'Remote',networkName:'Sepolia',mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:11155111,address,rpcUrl:'https://rpc.example',deploymentBlock:10,deploymentHash:'0x'+'a'.repeat(64),codeHash:'0x'+'b'.repeat(64),catalogHash:'c'.repeat(64)};
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),key:index=>[...values.keys()][index]??null,get length(){return values.size;}};
  const reader=new ChainReader(d,d.catalogHash,storage,1000,[32,128,32,16,4,32]);
  const make=blockNumber=>({format:CHAIN_SNAPSHOT_FORMAT,deployment:{id:d.id,chainId:d.chainId,address:d.address,deploymentBlock:d.deploymentBlock,deploymentHash:d.deploymentHash,codeHash:d.codeHash,catalogHash:d.catalogHash},snapshot:{format:CHAIN_SNAPSHOT_FORMAT,records:[],publicOpen:false,salePhase:0,total:0,cap:1000,publicMinted:0,allowlistMinted:0,price:'0',blockNumber,blockHash:'0x'+'f'.repeat(64),updatedAt:blockNumber}});
  assert.equal(reader.seedSnapshot(make(12)),true);assert.equal(reader.snapshot.blockNumber,12);assert.ok(values.get(reader.key));
  assert.equal(reader.seedSnapshot(make(11)),false);assert.equal(reader.snapshot.blockNumber,12);reader.destroy();
});
test('snapshot API seed requires a matching canonical and recent block, then safely falls back',async()=>{
  const d={id:'remote-api',label:'Remote',networkName:'Ethereum',mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:1,address,rpcUrl:'https://rpc.example',snapshotUrl:'https://cache.example/snapshot',deploymentBlock:10,deploymentHash:'0x'+'a'.repeat(64),codeHash:'0x'+'b'.repeat(64),catalogHash:'c'.repeat(64)};
  const blockHash='0x'+'f'.repeat(64),snapshot={format:CHAIN_SNAPSHOT_FORMAT,records:[],publicOpen:false,salePhase:0,total:0,cap:1000,publicMinted:0,allowlistMinted:0,price:'0',blockNumber:100,blockHash,updatedAt:1};
  const envelope={format:CHAIN_SNAPSHOT_FORMAT,deployment:{id:d.id,chainId:d.chainId,address:d.address,deploymentBlock:d.deploymentBlock,deploymentHash:d.deploymentHash,codeHash:d.codeHash,catalogHash:d.catalogHash},snapshot};
  const reader=new ChainReader(d,d.catalogHash,null,1000,[32,128,32,16,4,32]);
  reader.provider.getBlockNumber=async()=>120;reader.provider.getBlock=async()=>({hash:blockHash});
  const fetchImpl=async()=>({ok:true,json:async()=>envelope});
  assert.equal(await fetchAndSeedSnapshot(reader,d.snapshotUrl,{fetchImpl}),true);assert.equal(reader.snapshot,snapshot);
  await assert.rejects(()=>fetchAndSeedSnapshot(reader,d.snapshotUrl,{fetchImpl:async()=>({ok:true,json:async()=>({...envelope,deployment:{...envelope.deployment,chainId:11155111}})})}),/does not match/);
  await assert.rejects(()=>fetchAndSeedSnapshot(reader,d.snapshotUrl,{fetchImpl:async()=>({ok:true,json:async()=>({...envelope,deployment:{...envelope.deployment,address:buyer}})})}),/does not match/);
  reader.provider.getBlockNumber=async()=>300;await assert.rejects(()=>fetchAndSeedSnapshot(reader,d.snapshotUrl,{fetchImpl}),/stale/);
  reader.provider.getBlockNumber=async()=>120;reader.provider.getBlock=async()=>({hash:'0x'+'0'.repeat(64)});await assert.rejects(()=>fetchAndSeedSnapshot(reader,d.snapshotUrl,{fetchImpl}),/not canonical/);
  reader.destroy();
});
test('10001 records are valid collection state but oversized snapshots stay out of localStorage',()=>{
  const d={id:'large-cache',label:'Large',networkName:'Local',mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:31337,address,rpcUrl:'http://127.0.0.1:8545',deploymentBlock:1,deploymentHash:'0x'+'a'.repeat(64),codeHash:'0x'+'b'.repeat(64),catalogHash:'c'.repeat(64)};
  const records=Array.from({length:10001},(_,index)=>({tokenId:String(index+1),genotype:[index&255,index>>8&255,index>>16&255,0,0,0],price:'0',phase:'allowlist',step:0,buyer,owner:buyer,transactionHash:'0x'+index.toString(16).padStart(64,'0'),blockNumber:2}));
  const snapshot={format:CHAIN_SNAPSHOT_FORMAT,records,publicOpen:false,salePhase:1,total:records.length,cap:20000,publicMinted:0,allowlistMinted:records.length,price:'0',blockNumber:2,blockHash:'0x'+'f'.repeat(64),updatedAt:1};
  assert.equal(validateChainSnapshot(snapshot,d,268435456,[256,256,256,256,256,256]),snapshot);
  let writes=0;const storage={getItem:()=>null,setItem(){writes++;},removeItem(){},key(){return null;},length:0};
  const reader=new ChainReader(d,d.catalogHash,storage,268435456,[256,256,256,256,256,256]);reader.persist(snapshot);reader.destroy();
  assert.equal(writes,0);
});
test('wallet rejections and contract races have actionable messages',()=>{
  assert.match(friendlyError({code:4001}),/cancelled/);
  assert.match(friendlyError({code:'INSUFFICIENT_FUNDS'}),/gas/);
  assert.match(friendlyError({data:chainInterface.encodeErrorResult('IncorrectPayment',[1,0])}),/price changed/);
  assert.match(friendlyError({data:chainInterface.encodeErrorResult('CombinationAlreadyMinted',[0])}),/Change a trait/);
  assert.match(friendlyError({data:chainInterface.encodeErrorResult('AllowlistAllocationExceeded')}),/allowlist claims/);
  assert.match(friendlyError({data:chainInterface.encodeErrorResult('InvalidSalePhase')}),/sale phase/);
  assert.match(friendlyError(Error('Public minting is temporarily paused.')),/temporarily paused/);
  assert.equal(friendlyError(Error('Allowlist complete · 3 of 3 myFriends have found a home. Connect an eligible wallet or wait for public mint.')),'Allowlist complete · 3 of 3 myFriends have found a home. Connect an eligible wallet or wait for public mint.');
  assert.match(friendlyError(Error('This deployment does not use the current phased sale lifecycle.')),/retired/);
});
