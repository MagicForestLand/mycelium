import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {keccak256} from 'ethers';
import {compileContracts} from '../lib/compile-contracts.mjs';
import {deploymentPlan} from '../lib/deployment-plan.mjs';
import {productionManifest,sourceIdentity} from '../lib/release-binding.mjs';
import {assertExternalOutput} from '../lib/release-paths.mjs';

export const CI_REHEARSAL_KIND='SYNTHETIC_CI_REHEARSAL_NEVER_BROADCAST';
const addresses=Object.freeze({
  deployer:'0x7100000000000000000000000000000000000001',
  owner:'0x7100000000000000000000000000000000000002',
  treasury:'0x7100000000000000000000000000000000000003'
});

export function syntheticCiConfig(){
  const base={kind:'PRODUCTION',chainId:1,initialOwner:addresses.owner,treasury:addresses.treasury,royaltyReceiver:addresses.treasury,
    royaltyBps:500,saleCap:1000,deployer:addresses.deployer,nonce:0,
    roleCodeHashes:{initialOwner:keccak256('0x'),treasury:keccak256('0x'),royaltyReceiver:keccak256('0x')},
    treasuryProbeWei:'1',maxFeePerGas:'100000000000',maxPriorityFeePerGas:'5000000000',balanceBufferWei:'1000000000000000000'};
  return {...base,gasLimits:Object.fromEntries(deploymentPlan(base).steps.map(step=>[step.name,'15000000']))};
}

export function syntheticSiteInputs(manifest){
  const collection=manifest.steps.find(step=>step.name==='MyceliumFriends');assert.ok(collection,'Synthetic manifest has no collection');
  return {
    deployment:{version:1,kind:'MYCELIUM_VERIFIED_DEPLOYMENT',releaseStatus:'CURRENT_RELEASE',network:'mainnet',chainId:1,
      sourceCommit:manifest.source.commit,releaseDigest:manifest.digest,deploymentBlock:1,deploymentHash:'0x'+'11'.repeat(32),
      collection:{address:collection.address,runtimeHash:collection.runtimeHash,catalogHash:manifest.catalog.sha256},
      protocol:{mint:manifest.mintProtection.protocol,saleLifecycle:manifest.mintProtection.saleLifecycle}},
    site:{version:1,kind:'MYCELIUM_PUBLIC_SITE_CONFIG',projectId:'c1'.repeat(16),
      walletMetadata:{name:'Mycelium Friends CI rehearsal',description:'Synthetic CI export; never a deployment record.',
        url:'https://mycelium.magicforest.land/',icons:['https://mycelium.magicforest.land/output/branding/avatar.svg']},
      deployment:{id:'mycelium-ci-synthetic-mainnet',label:'Mycelium Friends CI rehearsal',networkName:'Ethereum',
        rpcUrl:'https://ci.invalid.example',snapshotUrl:'https://snapshot.invalid.example',
        explorers:{etherscan:'https://etherscan.io',evmNow:'https://evm.now'}}}
  };
}

export async function prepareCiRehearsal(outputDirectory){
  assertExternalOutput(outputDirectory);assert.ok(!existsSync(outputDirectory),'CI rehearsal output directory must not already exist');
  const source=sourceIdentity(),compilation=compileContracts({fixtures:false});
  const manifest=await productionManifest(syntheticCiConfig(),compilation,source),siteInputs=syntheticSiteInputs(manifest);
  assert.deepEqual(sourceIdentity(),source,'Sources changed during synthetic CI preparation');
  await mkdir(outputDirectory,{mode:0o700});
  const write=async(name,value)=>writeFile(path.join(outputDirectory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  await write('synthetic-manifest.json',manifest);await write('synthetic-deployment.json',siteInputs.deployment);await write('synthetic-site.json',siteInputs.site);
  await write('ci-context.json',{format:1,kind:CI_REHEARSAL_KIND,source:{commit:source.commit,tree:source.tree},releaseDigest:manifest.digest,
    warning:'Synthetic fixed roles and deployment evidence. Never sign or broadcast this manifest.'});
  return {manifest,outputDirectory:path.resolve(outputDirectory)};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [outputDirectory]=process.argv.slice(2);assert.ok(outputDirectory,'Usage: node tooling/testing/prepare-ci-rehearsal.mjs /absolute/external/output-directory');
  const {manifest}=await prepareCiRehearsal(outputDirectory);
  console.log(`${CI_REHEARSAL_KIND}: ${manifest.digest}. No transaction signed or broadcast.`);
}
