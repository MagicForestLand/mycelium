import {mintProtection} from '../../tooling/lib/mint-protocol.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,symlinkSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {keccak256} from 'ethers';
import {deploymentPlan} from '../../tooling/lib/deployment-plan.mjs';
import {projectRoot} from '../../tooling/lib/compile-contracts.mjs';
import {MAX_TRANSACTION_GAS_LIMIT,releaseDigest,assertApprovedDigest,validateProductionConfig,sourceIdentity,boundRuntime,productionReleaseFiles} from '../../tooling/lib/release-binding.mjs';
import {inspectProductionNetwork} from '../../tooling/verification/release-preflight.mjs';
import {assertExternalOutput} from '../../tooling/lib/release-paths.mjs';

const deployer='0x1000000000000000000000000000000000000001',owner='0x2000000000000000000000000000000000000002',nft='0x3000000000000000000000000000000000000003';
function config(){
  const base={kind:'PRODUCTION',chainId:1,initialOwner:owner,treasury:owner,royaltyReceiver:owner,royaltyBps:500,saleCap:1000,deployer,nonce:7,
    roleCodeHashes:{initialOwner:keccak256('0x'),treasury:keccak256('0x'),royaltyReceiver:keccak256('0x')},
    treasuryProbeWei:'1',maxFeePerGas:'20',maxPriorityFeePerGas:'2',balanceBufferWei:'100'};
  return {...base,gasLimits:Object.fromEntries(deploymentPlan(base).steps.map(s=>[s.name,'10000000']))};
}

test('production config has no silent role, nonce, tool or gas defaults',()=>{
  const good=config();assert.doesNotThrow(()=>validateProductionConfig(good));
  for(const key of Object.keys(good)){const bad={...good};delete bad[key];assert.throws(()=>validateProductionConfig(bad),key);}
  for(const patch of [{kind:'SYNTHETIC'},{deployer:owner.toLowerCase().replace('2','z')},{nonce:-1},{nonce:1.5},{gasLimits:{}},{roleCodeHashes:{}},
    {maxFeePerGas:'1'},{treasuryProbeWei:'0'},{balanceBufferWei:'-1'},{surprise:'ignored'},{maxFeePerGas:20}])assert.throws(()=>validateProductionConfig({...good,...patch}));
  const first=Object.keys(good.gasLimits)[0];
  assert.throws(()=>validateProductionConfig({...good,gasLimits:{...good.gasLimits,[first]:(MAX_TRANSACTION_GAS_LIMIT+1n).toString()}}),/EIP-7825/);
});

test('independent digest binds config, provenance, settings, generated/art bytes and resolved deployment',()=>{
  const manifest={mintProtection:{...mintProtection},format:2,kind:'PRODUCTION',status:'PREPARED_NOT_DEPLOYED',config:config(),source:{commit:'abc',tree:'def',packageLockHash:'123',toolchain:{solc:'0.8.30'}},
    compilerSettings:{optimizer:{enabled:true,runs:200},viaIR:false,evmVersion:'shanghai'},generatedSourceHashes:{bank:'production'},catalog:{sha256:'approved'},
    steps:[{address:nft,nonce:7,initcode:'0x1234',runtimeHash:'production'}]};
  manifest.digest=releaseDigest(manifest);assertApprovedDigest(manifest,manifest.digest);
  for(const expected of [undefined,'','0'.repeat(64)])assert.throws(()=>assertApprovedDigest(manifest,expected));
  const mutations=[m=>m.mintProtection.minimumAgeSeconds=0,m=>m.mintProtection.payment='EXACT_DIRECT',m=>m.config.treasury=deployer,m=>m.config.initialOwner=deployer,m=>m.config.royaltyReceiver=deployer,m=>m.config.deployer=owner,
    m=>m.config.chainId=11155111,m=>m.config.saleCap++,m=>m.config.nonce++,m=>m.source.commit='other',m=>m.source.tree='other',m=>m.source.packageLockHash='other',
    m=>m.source.toolchain.solc='other',m=>m.compilerSettings.optimizer.runs++,m=>m.compilerSettings.viaIR=true,m=>m.compilerSettings.evmVersion='cancun',
    m=>m.generatedSourceHashes.bank='synthetic',m=>m.catalog.sha256='synthetic',m=>m.steps[0].address=owner,m=>m.steps[0].initcode='0x00',m=>m.steps[0].runtimeHash='synthetic'];
  for(const mutate of mutations){const copy=structuredClone(manifest);mutate(copy);assert.throws(()=>assertApprovedDigest(copy,manifest.digest));
    copy.digest=releaseDigest(copy);assert.throws(()=>assertApprovedDigest(copy,manifest.digest));}
});

test('immutable runtime binding fails closed on unknown slots',()=>{
  const compiled={sources:{test:{ast:{nodes:[{nodeType:'VariableDeclaration',id:1,name:'treasury'}]}}}};
  const artifact={contractName:'Test',deployedBytecode:'0x'+'00'.repeat(32),immutableReferences:{1:[{start:0,length:32}]}};
  assert.equal(boundRuntime(compiled,artifact,{treasury:1}),'0x'+'00'.repeat(31)+'01');
  assert.throws(()=>boundRuntime(compiled,artifact,{}),/Missing immutable/);
});

test('git provenance rejects dirty tracked/untracked source and identifies commit, tree and lock',()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'mycelium-provenance-'));
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');mkdirSync(path.join(root,'tooling'));
  writeFileSync(path.join(root,'tooling/source.mjs'),'export const value=1;\n');
  writeFileSync(path.join(root,'package.json'),'{}');writeFileSync(path.join(root,'package-lock.json'),'{}');writeFileSync(path.join(root,'.gitignore'),'node_modules/\n');
  symlinkSync(path.join(projectRoot,'node_modules'),path.join(root,'node_modules'));
  git('add','.');git('-c','user.name=Release Test','-c','user.email=release-test@example.invalid','commit','-m','fixture');
  const releaseFiles=['tooling/source.mjs'];
  const first=sourceIdentity(root,releaseFiles);assert.equal(first.commit,git('rev-parse','HEAD'));assert.equal(first.tree,git('rev-parse','HEAD^{tree}'));
  writeFileSync(path.join(root,'extra.txt'),'untracked');assert.throws(()=>sourceIdentity(root,releaseFiles),/clean/);
  git('add','extra.txt');git('-c','user.name=Release Test','-c','user.email=release-test@example.invalid','commit','-m','second');
  assert.notEqual(sourceIdentity(root,releaseFiles).commit,first.commit);
  writeFileSync(path.join(root,'tooling/source.mjs'),'changed');assert.throws(()=>sourceIdentity(root,releaseFiles),/clean/);
});

test('production release set excludes docs, reports, browser checks and synthetic fixtures',()=>{
  const files=productionReleaseFiles(['contracts/core/MyceliumFriends.sol','collection/artwork/traits/stem/example.svg','collection/artwork/release-manifest.json',
    'tooling/lib/release-binding.mjs','tooling/synthetic-fixture.mjs','tooling/testing/check-web3.mjs','docs/repository/release/RELEASE.md','output/report.json']);
  assert.deepEqual(files,['collection/artwork/release-manifest.json','collection/artwork/traits/stem/example.svg','contracts/core/MyceliumFriends.sol','tooling/lib/release-binding.mjs']);
});

function networkFixture(){
  const c=config();c.gasLimits={MyceliumFriends:'1000000'};
  const manifest={digest:'a'.repeat(64),config:c,addresses:{MyceliumFriends:nft},steps:[{name:'MyceliumFriends',address:nft}],internalContracts:[]};
  const calls=[];
  const provider={send:async(method,args)=>{calls.push(method);
    if(method==='eth_chainId')return '0x1';
    if(method==='eth_getBlockByNumber')return{number:'0x10',hash:'0xblock',gasLimit:'0x1c9c380',baseFeePerGas:'0xa'};
    if(method==='eth_getTransactionCount')return args[0]===deployer?'0x7':'0x0';
    if(method==='eth_getCode')return '0x';
    if(method==='eth_getBalance')return '0xffffffffffffffff';
    if(method==='eth_call')return '0x';throw Error(`Unexpected RPC ${method}`);
  }};
  return{manifest,provider,calls,deployer};
}
test('preflight network checks sender, chain, both nonces, balance, fees, role code and address collisions without broadcast',async()=>{
  const good=networkFixture();const report=await inspectProductionNetwork(good);assert.equal(report.status,'PREFLIGHT_PASSED_NOT_BROADCAST');
  assert.ok(!good.calls.some(method=>/sendTransaction|sendRawTransaction/.test(method)));
  await assert.rejects(()=>inspectProductionNetwork({...networkFixture(),deployer:owner}),/deployer/);
  const cases=[['eth_chainId',()=> '0x2'],['eth_getTransactionCount',(args)=>args[0]===deployer?'0x8':'0x0'],
    ['eth_getTransactionCount',(args)=>args[1]==='pending'?'0x8':args[0]===deployer?'0x7':'0x0'],
    ['eth_getBalance',()=> '0x0'],['eth_getCode',()=> '0x6000'],['eth_call',()=>{throw Error('Rejected treasury');}],
    ['eth_getBlockByNumber',()=>({number:'0x10',hash:'0xblock',gasLimit:'0x1',baseFeePerGas:'0xa'})],
    ['eth_getCode',(args)=>args[0]===owner?'0x6000':'0x']];
  for(const [method,result] of cases){const f=networkFixture(),original=f.provider.send;f.provider.send=async(m,args)=>m===method?result(args):original(m,args);await assert.rejects(()=>inspectProductionNetwork(f));}
});

test('production report paths cannot dirty the source tree and CLI requires independent approval',()=>{
  assert.throws(()=>assertExternalOutput(path.join(projectRoot,'output/release/new.json')),/outside/);
  assert.throws(()=>assertExternalOutput(undefined),/Explicit/);
  assert.doesNotThrow(()=>assertExternalOutput(path.join(os.tmpdir(),'release-example.json')));
  const result=spawnSync(process.execPath,[path.join(projectRoot,'tooling/verification/release-preflight.mjs')],{encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Usage/);
});
