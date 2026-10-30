import test from 'node:test';
import assert from 'node:assert/strict';
import {Transaction,Wallet,getCreateAddress,keccak256} from 'ethers';
import {assertPinnedCastVersion,FOUNDRY_LEDGER_PIN,ledgerAddressArgs,ledgerSigningArgs,signMainnetIntentWithLedger} from '../../tooling/release/ledger-sign-intent.mjs';
import {mainnetDeploymentIntent} from '../../tooling/lib/mainnet-transactions.mjs';
import {releaseDigest} from '../../tooling/lib/release-binding.mjs';

const signer=new Wallet('0x'+'11'.repeat(32)),derivationPath="m/44'/60'/0'/0/0";

function fixture(){
  const nonce=7,initcode='0x60006000',address=getCreateAddress({from:signer.address,nonce});
  const payload={format:2,kind:'PRODUCTION',status:'PREPARED_NOT_DEPLOYED',config:{chainId:1,deployer:signer.address,nonce,
    gasLimits:{A:'100000'},maxFeePerGas:'2000000000',maxPriorityFeePerGas:'1000000000'},
    steps:[{name:'A',nonce,address,initcode,initcodeHash:keccak256(initcode),runtimeHash:keccak256('0x6001')}],internalContracts:[],addresses:{A:address}};
  return {...payload,digest:releaseDigest(payload)};
}

test('Ledger arguments bind every transaction field without an RPC or software-key option',()=>{
  const manifest=fixture(),intent=mainnetDeploymentIntent(manifest,manifest.digest,0),args=ledgerSigningArgs(intent,derivationPath);
  assert.deepEqual(ledgerAddressArgs(derivationPath),['wallet','address','--ledger','--mnemonic-derivation-path',derivationPath]);
  assert.deepEqual(args,['mktx','--chain','1','--nonce','7','--gas-limit','100000','--gas-price','2000000000',
    '--priority-gas-price','1000000000','--ledger','--mnemonic-derivation-path',derivationPath,'--create','0x60006000']);
  assert.equal(args.some(value=>value.includes('private-key')||value.includes('rpc')),false);
  assert.throws(()=>ledgerAddressArgs(''),/derivation path/);
  assert.throws(()=>ledgerSigningArgs({...intent,chainId:11155111},derivationPath),/mainnet/);
});

test('Foundry Ledger signer is pinned to one release commit',()=>{
  const output=`cast Version: ${FOUNDRY_LEDGER_PIN.version}\nCommit SHA: ${FOUNDRY_LEDGER_PIN.commit}\nBuild Profile: dist\n`;
  assert.doesNotThrow(()=>assertPinnedCastVersion(output));
  assert.throws(()=>assertPinnedCastVersion(output.replace('1.7.1','1.7.2')),/version/);
  assert.throws(()=>assertPinnedCastVersion(output.replace(FOUNDRY_LEDGER_PIN.commit,'0'.repeat(40))),/commit/);
});

test('Ledger workflow checks displayed address and independently verifies signed raw transaction',async()=>{
  const manifest=fixture(),intent=mainnetDeploymentIntent(manifest,manifest.digest,0);
  const raw=await signer.signTransaction(Transaction.from(intent.transaction.unsignedSerialized)),calls=[];
  const runCast=async(_binary,args)=>{calls.push(args);if(args[0]==='--version')return `cast Version: 1.7.1\nCommit SHA: ${FOUNDRY_LEDGER_PIN.commit}\n`;if(args[0]==='wallet')return signer.address;return raw;};
  const signed=await signMainnetIntentWithLedger({manifest,expectedDigest:manifest.digest,intent,derivationPath,castBinary:'/pinned/cast',runCast});
  assert.equal(signed.status,'SIGNED_NOT_BROADCAST');assert.equal(signed.ledgerAddress,signer.address);assert.equal(signed.rawTransaction,raw);
  assert.deepEqual(calls.map(args=>args[0]),['--version','wallet','mktx']);
  await assert.rejects(()=>signMainnetIntentWithLedger({manifest,expectedDigest:manifest.digest,intent,derivationPath,runCast:async(_binary,args)=>args[0]==='--version'?`cast Version: 1.7.1\nCommit SHA: ${FOUNDRY_LEDGER_PIN.commit}\n`:'0x2222222222222222222222222222222222222222'}),/differs/);
  let called=false;
  await assert.rejects(()=>signMainnetIntentWithLedger({manifest,expectedDigest:manifest.digest,intent:{...intent,nonce:8},derivationPath,
    runCast:async()=>{called=true;return '';} }),/intent changed/);
  assert.equal(called,false,'Ledger must not be prompted for a changed intent');
});
