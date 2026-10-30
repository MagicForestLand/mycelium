import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {semanticStorageLayout,STORAGE_LAYOUT_HASH_POLICY} from '../../verification/storage-layout.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');

test('dependency-free capsule verifier checks exact compiler artifacts and fails closed',()=>{
  const directory=mkdtempSync(path.join(os.tmpdir(),'mycelium-capsule-verifier-'));
  const artifact={abi:[{type:'constructor',inputs:[]}],storageLayout:{storage:[{astId:7,contract:'contracts/core/Example.sol:Example',label:'bank',offset:0,slot:'0',type:'t_contract(IArtBank)8'}],types:{'t_contract(IArtBank)8':{encoding:'inplace',label:'contract IArtBank',numberOfBytes:'20'}}},evm:{bytecode:{object:'6000'},deployedBytecode:{object:'6001'}}};
  const summary={releaseDigest:'a'.repeat(64),storageLayoutHashPolicy:STORAGE_LAYOUT_HASH_POLICY,contracts:[{name:'Example',source:'contracts/core/Example.sol',compilerContract:'contracts/core/Example.sol:Example',
    abiSha256:sha256(JSON.stringify(artifact.abi)),storageLayoutSha256:sha256(JSON.stringify(semanticStorageLayout(artifact.storageLayout))),
    creationBytecodeSha256:sha256(Buffer.from('6000','hex')),runtimeTemplateSha256:sha256(Buffer.from('6001','hex'))}]};
  const output={contracts:{'contracts/core/Example.sol':{Example:artifact}}};
  const outputPath=path.join(directory,'output.json'),summaryPath=path.join(directory,'summary.json');
  writeFileSync(outputPath,JSON.stringify(output));writeFileSync(summaryPath,JSON.stringify(summary));
  const verifier=new URL('../../verification/verify-standard-json.mjs',import.meta.url);
  const good=spawnSync(process.execPath,[verifier.pathname,outputPath,summaryPath],{encoding:'utf8'});
  assert.equal(good.status,0,good.stderr);assert.match(good.stdout,/PASS source capsule compiler output/);
  output.contracts['contracts/core/Example.sol'].Example.storageLayout={storage:[{astId:7000,contract:'contracts/core/Example.sol:Example',label:'bank',offset:0,slot:'0',type:'t_contract(IArtBank)8000'}],types:{'t_contract(IArtBank)8000':{encoding:'inplace',label:'contract IArtBank',numberOfBytes:'20'}}};
  writeFileSync(outputPath,JSON.stringify(output));
  const renumbered=spawnSync(process.execPath,[verifier.pathname,outputPath,summaryPath],{encoding:'utf8'});
  assert.equal(renumbered.status,0,renumbered.stderr);assert.match(renumbered.stdout,/PASS source capsule compiler output/);
  output.contracts['contracts/core/Example.sol'].Example.storageLayout.storage[0].slot='1';writeFileSync(outputPath,JSON.stringify(output));
  const wrongSlot=spawnSync(process.execPath,[verifier.pathname,outputPath,summaryPath],{encoding:'utf8'});
  assert.notEqual(wrongSlot.status,0);assert.match(wrongSlot.stderr,/storage layout differs/);
  output.contracts['contracts/core/Example.sol'].Example.storageLayout.storage[0].slot='0';
  output.contracts['contracts/core/Example.sol'].Example.evm.deployedBytecode.object='6002';writeFileSync(outputPath,JSON.stringify(output));
  const bad=spawnSync(process.execPath,[verifier.pathname,outputPath,summaryPath],{encoding:'utf8'});
  assert.notEqual(bad.status,0);assert.match(bad.stderr,/runtime template differs/);
});
