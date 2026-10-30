import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {ANVIL_FORK_PIN,ANVIL_TRANSACTION_GAS_CAP_ERROR,assertLoopbackRpcUrl,inspectPinnedAnvilFork,safePrevalidatedSignature,validateForkExecutionEnvironment,verifiedTransactionGasCapRejection,verifyTransactionGasCap,waitForTransactionReceipt} from '../../tooling/verification/mainnet-fork.mjs';
import {ANVIL_COMMIT,anvilLaunchArguments,assertPinnedAnvilVersion,publicRpcIdentity,sanitizedLaunchTranscript,stopChild,verifyFinalizedBlockConsensus} from '../../tooling/verification/run-mainnet-fork.mjs';

test('fork rehearsal accepts only credential-free loopback HTTP RPC',()=>{
  assert.equal(assertLoopbackRpcUrl('http://127.0.0.1:8545/'),'http://127.0.0.1:8545/');
  assert.equal(assertLoopbackRpcUrl('http://localhost:9545'),'http://localhost:9545/');
  for(const value of ['https://mainnet.example','ws://127.0.0.1:8545','http://user:secret@127.0.0.1:8545'])assert.throws(()=>assertLoopbackRpcUrl(value));
});

test('fork rehearsal binds Anvil version, chain and pristine pinned head',async()=>{
  const forkBlock=25_000_000,forkHash='0x'+'ab'.repeat(32),calls=[];
  const provider={send:async(method,args)=>{calls.push([method,args]);
    if(method==='web3_clientVersion')return `anvil/v${ANVIL_FORK_PIN.version}`;
    if(method==='eth_chainId')return '0x1';
    if(method==='anvil_nodeInfo')return {hardFork:'Osaka'};
    if(method==='eth_getBlockByNumber')return {number:'0x'+forkBlock.toString(16),hash:forkHash,baseFeePerGas:'0x1',gasLimit:'0x3938700'};
    throw Error(method);
  }};
  const result=await inspectPinnedAnvilFork({provider,forkBlock,forkHash,probeGasCap:async()=>({status:'OBSERVED_BOUNDARY'})});
  assert.equal(result.blockNumber,forkBlock);assert.equal(result.blockHash,forkHash);assert.equal(result.gasLimit,'60000000');
  assert.equal(result.observedHardfork,'osaka');assert.equal(calls.filter(([method])=>method==='eth_getBlockByNumber').length,3);
  const response=(method,version='1.7.1',hardFork='Osaka')=>method==='web3_clientVersion'?`anvil/v${version}`:method==='eth_chainId'?'0x1':method==='anvil_nodeInfo'?{hardFork}:{number:'0x1',hash:forkHash,baseFeePerGas:'0x1',gasLimit:'0x1'};
  await assert.rejects(()=>inspectPinnedAnvilFork({provider:{send:async method=>response(method,'1.7.2')},forkBlock:1,forkHash,probeGasCap:async()=>({})}),/v1.7.1/);
  await assert.rejects(()=>inspectPinnedAnvilFork({provider:{send:async method=>response(method,'1.7.1','Prague')},forkBlock:1,forkHash,probeGasCap:async()=>({})}),/hardfork/);
});

test('fork rehearsal observes the exact EIP-7825 transaction gas boundary and restores state',async()=>{
  const calls=[],receipt={status:'0x1'};let receiptReads=0;
  const provider={send:async(method,args)=>{calls.push([method,args]);
    if(method==='eth_getBlockByNumber')return {baseFeePerGas:'0x1'};
    if(method==='evm_snapshot')return '0x1';if(method==='evm_revert')return true;
    if(['anvil_setBalance','anvil_impersonateAccount','anvil_stopImpersonatingAccount'].includes(method))return true;
    if(method==='eth_sendTransaction'){
      const gas=BigInt(args[0].gas);if(gas>BigInt(ANVIL_FORK_PIN.transactionGasCap)){
        const error=Error('could not coalesce error');error.code='UNKNOWN_ERROR';error.error={...ANVIL_TRANSACTION_GAS_CAP_ERROR};
        error.payload={method:'eth_sendTransaction',params:args};throw error;
      }
      return '0x'+'12'.repeat(32);
    }
    if(method==='eth_getTransactionReceipt')return receiptReads++===0?null:receipt;throw Error(method);
  }};
  const result=await verifyTransactionGasCap({provider});
  assert.deepEqual({status:result.status,maximumAcceptedGas:result.maximumAcceptedGas,firstRejectedGas:result.firstRejectedGas},
    {status:'OBSERVED_BOUNDARY',maximumAcceptedGas:'16777216',firstRejectedGas:'16777217'});
  assert.equal(calls.filter(([method])=>method==='eth_sendTransaction').length,2);
  assert.equal(calls.at(-1)[0],'evm_revert');
});

test('fork gas-cap proof rejects transport and unrelated RPC failures',async()=>{
  const probe='0x0000000000000000000000000000000000007825',gas=BigInt(ANVIL_FORK_PIN.transactionGasCap)+1n,
    payload={method:'eth_sendTransaction',params:[{from:probe,to:probe,gas:'0x1000001'}]},valid=Error('wrapped');
  valid.error={...ANVIL_TRANSACTION_GAS_CAP_ERROR};valid.payload=payload;
  assert.deepEqual(verifiedTransactionGasCapRejection(valid,{gas,from:probe,to:probe}),ANVIL_TRANSACTION_GAS_CAP_ERROR);
  for(const error of [
    Object.assign(Error('simulated transport timeout with no EIP-7825 rejection'),{code:'TIMEOUT'}),
    Object.assign(Error('wrapped'),{error:{code:-32000,message:'unrelated server error'},payload}),
    Object.assign(Error('wrapped'),{error:{...ANVIL_TRANSACTION_GAS_CAP_ERROR},payload:{...payload,method:'eth_call'}}),
    Object.assign(Error('wrapped'),{error:{...ANVIL_TRANSACTION_GAS_CAP_ERROR},payload:{...payload,params:[{...payload.params[0],gas:'0x1000002'}]}})
  ])assert.throws(()=>verifiedTransactionGasCapRejection(error,{gas,from:probe,to:probe}));

  const calls=[],provider={send:async(method,args)=>{calls.push([method,args]);
    if(method==='eth_getBlockByNumber')return {baseFeePerGas:'0x1'};
    if(method==='evm_snapshot')return '0x1';if(method==='evm_revert')return true;
    if(['anvil_setBalance','anvil_impersonateAccount','anvil_stopImpersonatingAccount'].includes(method))return true;
    if(method==='eth_getTransactionReceipt')return {status:'0x1'};
    if(method==='eth_sendTransaction'){if(BigInt(args[0].gas)>BigInt(ANVIL_FORK_PIN.transactionGasCap))throw Object.assign(Error('timeout'),{code:'TIMEOUT'});return '0x'+'12'.repeat(32);}
    throw Error(method);
  }};
  await assert.rejects(()=>verifyTransactionGasCap({provider}),/pinned Anvil gas-cap error code/);
  assert.equal(calls.at(-1)[0],'evm_revert','Unrelated above-cap errors must still restore the probe snapshot');
});

test('fork receipt polling waits for asynchronous mining and fails closed on timeout',async()=>{
  const hash='0x'+'34'.repeat(32),receipt={status:'0x1'};let reads=0,pauses=0;
  const provider={send:async method=>{assert.equal(method,'eth_getTransactionReceipt');return reads++<2?null:receipt;}};
  assert.equal(await waitForTransactionReceipt({provider,transactionHash:hash,attempts:3,pollIntervalMs:0,pause:async()=>{pauses++;}}),receipt);
  assert.equal(reads,3);assert.equal(pauses,2);
  await assert.rejects(()=>waitForTransactionReceipt({provider:{send:async()=>null},transactionHash:hash,attempts:2,pollIntervalMs:0,pause:async()=>{}}),/unavailable after 2 attempts/);
});

test('managed fork launcher records exact sanitized arguments and pinned binary identity',()=>{
  assert.deepEqual(publicRpcIdentity('https://primary.example/rpc?token=secret'),{hostname:'primary.example',port:'443'});
  for(const value of ['http://primary.example','https://user:secret@primary.example'])assert.throws(()=>publicRpcIdentity(value));
  const args=anvilLaunchArguments({upstreamRpc:'https://primary.example/secret',forkBlock:25_000_000,port:19546});
  assert.ok(args.includes('osaka')&&args.includes('--enable-tx-gas-limit')&&args.includes('--no-storage-caching'));
  const transcript=sanitizedLaunchTranscript('/pinned/anvil',args);
  assert.ok(!JSON.stringify(transcript).includes('/secret'));assert.ok(transcript.command.includes('REDACTED_UPSTREAM_MAINNET_RPC'));
  assert.doesNotThrow(()=>assertPinnedAnvilVersion(`anvil Version: 1.7.1\nCommit SHA: ${ANVIL_COMMIT}`));
  assert.throws(()=>assertPinnedAnvilVersion('anvil Version: 1.7.2\nCommit SHA: '+ANVIL_COMMIT));
});

test('managed fork cleanup handles signal exits and escalates only a live child',async()=>{
  const signaled=new EventEmitter();signaled.exitCode=null;signaled.signalCode=null;const signals=[];
  signaled.kill=signal=>{signals.push(signal);signaled.signalCode=signal;signaled.emit('exit',null,signal);return true;};
  await stopChild(signaled,{wait:async()=>{}});assert.deepEqual(signals,['SIGTERM']);

  const stubborn=new EventEmitter();stubborn.exitCode=null;stubborn.signalCode=null;const escalated=[];
  stubborn.kill=signal=>{escalated.push(signal);if(signal==='SIGKILL'){stubborn.signalCode=signal;stubborn.emit('exit',null,signal);}return true;};
  await stopChild(stubborn,{wait:async()=>{}});assert.deepEqual(escalated,['SIGTERM','SIGKILL']);

  const alreadyExited=new EventEmitter();alreadyExited.exitCode=null;alreadyExited.signalCode='SIGTERM';alreadyExited.kill=()=>{throw Error('must not signal an exited child');};
  await stopChild(alreadyExited,{wait:async()=>{}});
});

test('fork block provenance requires two independent finalized mainnet providers',async()=>{
  const forkBlock=25_000_000,forkHash='0x'+'ab'.repeat(32),finalizedHash='0x'+'cd'.repeat(32),destroyed=[];
  const providerFactory=url=>({send:async(method,args)=>{
    if(method==='eth_chainId')return '0x1';
    if(method==='eth_getBlockByNumber')return args[0]==='finalized'?{number:'0x'+(forkBlock+10).toString(16),hash:finalizedHash}:{number:'0x'+forkBlock.toString(16),hash:forkHash};
    throw Error(method);
  },destroy:()=>destroyed.push(url)});
  const result=await verifyFinalizedBlockConsensus({rpcUrls:['https://one.example/a','https://two.example/b'],forkBlock,forkHash,providerFactory});
  assert.equal(result.status,'TWO_PROVIDER_FINALIZED_BLOCK_CONSENSUS');assert.equal(result.providers.length,2);assert.equal(destroyed.length,2);
  assert.ok(!JSON.stringify(result).includes('/a')&&!JSON.stringify(result).includes('/b'));
  await assert.rejects(()=>verifyFinalizedBlockConsensus({rpcUrls:['https://same.example/a','https://same.example/b'],forkBlock,forkHash,providerFactory}),/different hostnames/);
});

test('fork execution evidence fails closed on declared-only or secret-bearing provenance',()=>{
  const forkBlock=25_000_000,forkHash='0x'+'ab'.repeat(32),port=19546,executable='/pinned/anvil',
    args=anvilLaunchArguments({upstreamRpc:'https://one.example/private',forkBlock,port}),transcript=sanitizedLaunchTranscript(executable,args),
    provider=(hostname,finalizedBlockHash)=>({hostname,port:'443',chainId:'1',pinnedBlockHash:forkHash,finalizedBlockNumber:forkBlock+10,finalizedBlockHash});
  const evidence={format:1,kind:'MYCELIUM_PINNED_ANVIL_EXECUTION',binary:{sha256:'1'.repeat(64),expectedSha256:'1'.repeat(64),version:ANVIL_FORK_PIN.version,commit:ANVIL_FORK_PIN.commit},
    launch:{manager:'REPOSITORY_MANAGED_CHILD_PROCESS',...transcript,chainId:1,host:'127.0.0.1',port,hardfork:'osaka',transactionGasCap:'16777216',noStorageCaching:true},
    blockConsensus:{status:'TWO_PROVIDER_FINALIZED_BLOCK_CONSENSUS',blockNumber:forkBlock,blockHash:forkHash,
      providers:[provider('one.example','0x'+'cd'.repeat(32)),provider('two.example','0x'+'ef'.repeat(32))]}};
  assert.equal(validateForkExecutionEnvironment(evidence,forkBlock,forkHash),evidence);
  for(const mutate of [
    value=>value.launch.hardfork='latest',value=>value.launch.arguments[5]='latest',value=>value.launch.transactionGasCap='30000000',
    value=>value.blockConsensus.providers[1].hostname='one.example',value=>value.blockConsensus.providers[0].url='https://one.example/private'
  ]){const changed=structuredClone(evidence);mutate(changed);assert.throws(()=>validateForkExecutionEnvironment(changed,forkBlock,forkHash));}
});

test('Safe fork helper encodes a prevalidated owner signature',()=>{
  const first='0x1000000000000000000000000000000000000001';
  const signature=safePrevalidatedSignature(first);
  assert.equal((signature.length-2)/2,65);assert.equal(signature.slice(2,66),'0'.repeat(24)+first.slice(2));assert.equal(signature.slice(-2),'01');
});
