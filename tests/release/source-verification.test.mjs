import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {standardCompilerInput} from '../../tooling/lib/compile-contracts.mjs';
import {sourceVerificationBundle} from '../../tooling/verification/source-verification.mjs';
import {staticAnalysisInput} from '../../tooling/verification/prepare-static-analysis.mjs';
import {inspectSourceCapsule,sourceCapsuleFiles} from '../../tooling/release/export-source-capsule.mjs';
import {STORAGE_LAYOUT_HASH_POLICY} from '../../verification/storage-layout.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');

function fixture(){
  const input=standardCompilerInput({fixtures:false}),sourceHashes=Object.fromEntries(Object.entries(input.sources).map(([name,{content}])=>[name,sha256(content)]));
  return {digest:'a'.repeat(64),source:{commit:'b'.repeat(40),tree:'c'.repeat(40)},compiler:'0.8.37+commit.f401782d.Emscripten.clang',compilerSettings:input.settings,sourceHashes,steps:[{
    name:'Example',file:'contracts/core/MyceliumFriends.sol',address:'0x1111111111111111111111111111111111111111',artifact:{bytecode:'0x6000',deployedBytecode:'0x6001',abi:[],storageLayout:{storage:[],types:null}},
    initcode:'0x6000abcd',creationCodeHash:'0x'+'1'.repeat(64),initcodeHash:'0x'+'2'.repeat(64),runtimeHash:'0x'+'3'.repeat(64)
  }]};
}

test('source verification bundle contains every import and exact constructor suffix',()=>{
  const bundle=sourceVerificationBundle(fixture());
  assert.ok(Object.keys(bundle.standardInput.sources).length>20);
  assert.ok(bundle.standardInput.sources['@openzeppelin/contracts/token/ERC721/ERC721.sol']);
  assert.equal(bundle.summary.contracts[0].constructorArguments,'0xabcd');
  assert.match(bundle.summary.standardInputSha256,/^[0-9a-f]{64}$/);
  assert.match(bundle.summary.contracts[0].abiSha256,/^[0-9a-f]{64}$/);
  assert.match(bundle.summary.contracts[0].storageLayoutSha256,/^[0-9a-f]{64}$/);
  assert.equal(bundle.summary.storageLayoutHashPolicy,STORAGE_LAYOUT_HASH_POLICY);
  assert.match(bundle.summary.contracts[0].creationBytecodeSha256,/^[0-9a-f]{64}$/);
  assert.match(bundle.summary.contracts[0].runtimeTemplateSha256,/^[0-9a-f]{64}$/);
});

test('minimal capsule is release-scoped, independently compilable and honest about Git identity',async()=>{
  const manifest=fixture(),bundle=sourceVerificationBundle(manifest);
  const evidence={format:1,kind:'MYCELIUM_ARCHITECTURE_EQUIVALENCE',candidateCommit:manifest.source.commit,baselineCommit:'d'.repeat(40),allEquivalent:true,artifacts:{}};
  const files=await sourceCapsuleFiles(manifest,bundle,evidence),inventory=inspectSourceCapsule(files,manifest.digest);
  const releaseRoot=`verification/core/releases/${manifest.digest}/`;
  assert.ok(files.has('contracts/core/MyceliumFriends.sol'));
  assert.ok(files.has('verification/verify-standard-json.mjs'));
  assert.ok(files.has('verification/storage-layout.mjs'));
  assert.ok(files.has(releaseRoot+'standard-json-input.json'));
  assert.ok(JSON.parse(files.get(releaseRoot+'standard-json-input.json')).sources['@openzeppelin/contracts/token/ERC721/ERC721.sol']);
  const snapshot=JSON.parse(files.get(releaseRoot+'SOURCE-SNAPSHOT.json'));
  assert.deepEqual(snapshot.developmentSource,manifest.source);
  assert.equal(snapshot.identityPolicy,'CAPSULE_GIT_IDENTITY_IS_SEPARATE_AND_NOT_PREDICTED');
  assert.equal(Object.keys(snapshot.files).some(file=>file.includes('SOURCE-SNAPSHOT')),false);
  assert.ok(inventory.files.every(file=>!file.startsWith('internal/')));
});

test('source verification bundle rejects source or initcode divergence',()=>{
  const changed=fixture();changed.sourceHashes['contracts/core/MyceliumFriends.sol']='0'.repeat(64);
  assert.throws(()=>sourceVerificationBundle(changed),/sources differ/);
  const bad=fixture();bad.steps[0].initcode='0x6100';assert.throws(()=>sourceVerificationBundle(bad),/does not begin/);
});

test('static analysis input keeps exact production sources/settings and adds only source maps',()=>{
  const production=standardCompilerInput({fixtures:false}),analysis=staticAnalysisInput();
  assert.deepEqual(analysis.sources,production.sources);
  for(const key of ['optimizer','viaIR','evmVersion'])assert.deepEqual(analysis.settings[key],production.settings[key]);
  assert.deepEqual(analysis.settings.outputSelection['*'][''],production.settings.outputSelection['*']['']);
  assert.deepEqual(analysis.settings.outputSelection['*']['*'].filter(field=>!field.endsWith('.sourceMap')),production.settings.outputSelection['*']['*']);
  assert.equal(Object.keys(analysis.sources).some(name=>name.startsWith('tests/contracts/core/fixtures/')),false);
});
