import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {ZeroAddress} from 'ethers';
import {deploymentPlan,validateDeploymentConfig,resolveArguments,catalogFingerprint} from '../../tooling/lib/deployment-plan.mjs';
import {assertGeneratedSources} from '../../tooling/lib/check-generated.mjs';
import {projectRoot} from '../../tooling/lib/compile-contracts.mjs';
import {MAX_SUPPLY} from '../../collection/source/token-id.js';

const config={chainId:1337,treasury:'0x0000000000000000000000000000000000000001',initialOwner:'0x0000000000000000000000000000000000000002',royaltyReceiver:'0x0000000000000000000000000000000000000003',saleCap:1000,royaltyBps:500};
const sha256=value=>createHash('sha256').update(value).digest('hex');
test('release plan requires explicit valid immutable policy and orders all dependencies',()=>{
  for(const invalid of [{chainId:0},{treasury:ZeroAddress},{initialOwner:'invalid'},{saleCap:0},{saleCap:MAX_SUPPLY+1},
    ...[undefined,null,-1,0,499,501,10000,10001,1.5,'500',NaN,Infinity].map(royaltyBps=>({royaltyBps})),
    ...[undefined,ZeroAddress,'invalid'].map(royaltyReceiver=>({royaltyReceiver}))])
    assert.throws(()=>validateDeploymentConfig({...config,...invalid}));
  const plan=deploymentPlan(config),addresses={};
  for(const step of plan.steps){
    assert.doesNotThrow(()=>resolveArguments(step.args,addresses));
    addresses[step.name]=config.treasury;
  }
  assert.throws(()=>resolveArguments(['$Missing'],addresses));
  assert.deepEqual(plan.steps.at(-1).args.slice(2),[config.treasury,config.initialOwner,1000,config.royaltyReceiver]);
  assert.doesNotThrow(()=>validateDeploymentConfig(config));
  assert.equal(catalogFingerprint().genotypeSpace,MAX_SUPPLY);
});
test('compiler rejects stale banks, counts, SVG, editorial metadata and manifests before release',()=>{
  assert.doesNotThrow(()=>assertGeneratedSources());
  for(const changed of ['contracts/core/generated/ArtBanks.sol','contracts/core/generated/GenomeSchema.sol','contracts/core/generated/SVGConstants.sol','contracts/core/generated/MetadataContent.sol','output/collection-metadata.json','output/art-bank-manifest.json','docs/collection/COLLECTION-CONTENT.md']){
    assert.throws(()=>assertGeneratedSources(file=>readFileSync(new URL('../../'+file,import.meta.url),'utf8')+(file===changed?'\n':'')),/is stale/);
  }
});
test('legacy owner config is rejected even when initialOwner is also supplied',()=>{
  for(const initialOwner of [undefined,config.initialOwner])
    assert.throws(()=>validateDeploymentConfig({...config,initialOwner,phenotypeAdmin:config.initialOwner}),/obsolete/);
});
test('deployment records use the browser catalog and bind published source verification',()=>{
  const directory=new URL('../../deployments/',import.meta.url);
  const manifests=readdirSync(directory,{recursive:true})
    .filter(file=>file.endsWith('.json'))
    .sort();
  const releaseIndex=JSON.parse(readFileSync(new URL('../../verification/core/release-index.json',import.meta.url),'utf8'));
  const isPublishedCheckout=existsSync(path.join(projectRoot,'PROJECT-EXPORT.json'));
  assert.equal(releaseIndex.format,1);
  assert.equal(releaseIndex.kind,'MYCELIUM_SOURCE_VERIFICATION_RELEASE_INDEX');
  const fingerprint=catalogFingerprint().sha256;
  // A history-free public snapshot is valid before its first mainnet deployment.
  // Validate every record that exists without manufacturing a deployment record.
  for(const file of manifests){
    const deployment=JSON.parse(readFileSync(new URL(file,directory),'utf8'));
    if(deployment.releaseStatus==='HISTORICAL_PRE_RELEASE'){
      assert.notEqual(deployment.collection.catalogHash,fingerprint,`${file} no longer needs a historical marker`);
      assert.match(deployment.compatibilityNote,/must not be used as the current release candidate/i);
      continue;
    }
    assert.equal(deployment.collection.catalogHash,fingerprint,`${file} catalog differs from the browser bundle`);
    assert.match(deployment.releaseDigest,/^[0-9a-f]{64}$/,`${file} has an invalid release digest`);
    const indexed=releaseIndex.releases?.[deployment.releaseDigest];
    assert.ok(indexed,`${file} has no indexed source-verification release`);
    assert.equal(indexed.sourceCommit,deployment.sourceCommit,`${file} source commit differs from its verification capsule`);
    assert.match(indexed.sourceTree,/^[0-9a-f]{40}$/,`${file} has an invalid source tree`);
    assert.equal(indexed.capsule.repository,'https://github.com/MagicForestLand/mycelium');
    assert.match(indexed.capsule.commit,/^[0-9a-f]{40}$/,`${file} has an invalid capsule commit`);
    assert.equal(indexed.capsule.path,`verification/core/releases/${deployment.releaseDigest}`);
    assert.deepEqual(Object.keys(indexed.capsule.files).sort(),[
      'SOURCE-SNAPSHOT.json','THIRD-PARTY-NOTICES.md','standard-json-input.json','verification-summary.json'
    ]);
    for(const [name,hash] of Object.entries(indexed.capsule.files))assert.match(hash,/^[0-9a-f]{64}$/,`${name} has an invalid capsule hash`);

    // The capsule is intentionally external to the private development checkout.
    // A full public checkout is marked by PROJECT-EXPORT.json and must retain it.
    const releaseDirectory=new URL(`../../${indexed.capsule.path}/`,import.meta.url);
    if(isPublishedCheckout)assert.ok(existsSync(releaseDirectory),`${file} capsule is missing from the full public checkout`);
    if(existsSync(releaseDirectory))for(const [name,hash] of Object.entries(indexed.capsule.files)){
      const target=new URL(name,releaseDirectory);
      assert.ok(existsSync(target),`${file} capsule is missing ${name}`);
      assert.equal(sha256(readFileSync(target)),hash,`${file} capsule ${name} differs from its publication index`);
    }
  }
});
