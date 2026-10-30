import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectPublishedRepositoryCheckout,secretFindingsInText,selectPublicRepositoryFiles,validatePublicRepositorySpec} from '../../tooling/release/export-public-repository.mjs';

const spec={format:2,kind:'MYCELIUM_PUBLIC_REPOSITORY_EXPORT',includeFiles:['README.md','.env.example'],includeDirectories:['contracts'],optionalIncludeFiles:['PROJECT-EXPORT.json'],excludeDirectories:['internal']};

test('public repository classifies every source and excludes the entire private boundary',()=>{
  assert.deepEqual(selectPublicRepositoryFiles(['contracts/core/A.sol','README.md','internal/old.sol','.env.example'],spec),['.env.example','README.md','contracts/core/A.sol']);
  assert.throws(()=>selectPublicRepositoryFiles(['contracts/core/A.sol','README.md','internal/old.sol','.env.example','private.txt'],spec),/Unclassified tracked files/);
  assert.throws(()=>selectPublicRepositoryFiles(['contracts/core/A.sol','README.md','internal/old.sol','.env.example','.env.production'],{
    ...spec,includeFiles:[...spec.includeFiles,'.env.production']
  }),/Forbidden public repository path/);
});

test('public repository manifest rejects ambiguous and unsafe paths',()=>{
  assert.throws(()=>validatePublicRepositorySpec({...spec,includeFiles:['README.md','README.md']}),/duplicates/);
  assert.throws(()=>validatePublicRepositorySpec({...spec,includeFiles:['../../README.md']}),/normalized relative paths/);
  assert.throws(()=>validatePublicRepositorySpec({...spec,includeFiles:['../README.md']}),/normalized relative paths/);
  assert.throws(()=>validatePublicRepositorySpec({...spec,includeFiles:['internal/private.json']}),/Private internal/);
  assert.throws(()=>validatePublicRepositorySpec({...spec,includeDirectories:['internal']}),/Private internal/);
  assert.throws(()=>validatePublicRepositorySpec({...spec,excludeDirectories:['contracts']}),/private internal boundary/);
});

test('public inventory works with no private tree and optional project-export provenance',()=>{
  const files=['README.md','.env.example','contracts/core/A.sol'];
  assert.deepEqual(selectPublicRepositoryFiles(files,spec),files.toSorted());
  assert.deepEqual(selectPublicRepositoryFiles([...files,'PROJECT-EXPORT.json'],spec),[...files,'PROJECT-EXPORT.json'].toSorted());
  assert.deepEqual(selectPublicRepositoryFiles([...files,'internal/new-secret/wallet.json','internal/testnet/apps/web/index.html'],spec),files.toSorted());
});

test('public repository secret scan catches wallet key material without flagging hashes',()=>{
  const key='a'.repeat(64),hash='b'.repeat(64);
  assert.deepEqual(secretFindingsInText(`{"privateKey":"0x${key}"}`,'wallet.json'),[{file:'wallet.json',rule:'raw private-key field'}]);
  assert.deepEqual(secretFindingsInText(`{"transactionHash":"0x${hash}"}`,'receipt.json'),[]);
});

test('published checkout requires the exact full export and every indexed capsule file',async()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'mycelium-published-checkout-'));
  const write=(file,value)=>{const target=path.join(root,file);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,value);};
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const digest='a'.repeat(64),commit='b'.repeat(40),readme='public project\n',capsule='immutable capsule\n';
  const indexPath='verification/core/release-index.json';
  const capsulePath=`verification/core/releases/${digest}/verification-summary.json`;
  const index=JSON.stringify({format:1,kind:'MYCELIUM_SOURCE_VERIFICATION_RELEASE_INDEX',releases:{[digest]:{capsule:{repository:'https://github.com/MagicForestLand/mycelium',commit,path:`verification/core/releases/${digest}`,files:{'verification-summary.json':hash(capsule)}}}}},null,2)+'\n';
  const provenance=JSON.stringify({format:1,kind:'MYCELIUM_FULL_PROJECT_EXPORT',source:{commit,tree:'c'.repeat(40)},exportSpec:'tooling/config/public-repository.json',excludedDirectories:['internal'],files:{'README.md':hash(readme),[indexPath]:hash(index)}},null,2)+'\n';
  write('README.md',readme);write(indexPath,index);write(capsulePath,capsule);write('PROJECT-EXPORT.json',provenance);
  const files=['README.md',indexPath,capsulePath,'PROJECT-EXPORT.json'];
  await assert.doesNotReject(()=>inspectPublishedRepositoryCheckout(files,root));
  await assert.rejects(()=>inspectPublishedRepositoryCheckout(files.filter(file=>file!==capsulePath),root),/exactly the full-project export/);
  write(capsulePath,'changed capsule\n');
  await assert.rejects(()=>inspectPublishedRepositoryCheckout(files,root),/differs from its recorded hash/);
});
