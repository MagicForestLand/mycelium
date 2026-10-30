import {mintProtection} from '../lib/mint-protocol.mjs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {JsonRpcProvider,getAddress} from 'ethers';
import {compileContracts,artifactFor} from '../lib/compile-contracts.mjs';
import {catalogFingerprint,deploymentPlan} from '../lib/deployment-plan.mjs';
import {verifyDeployment} from '../lib/verify-deployment.mjs';
import {assertArtApproval} from './artwork-release-lock.mjs';
import {fileURLToPath} from 'node:url';
import {verifyProductionInputs} from '../lib/release-binding.mjs';
import {keccak256} from 'ethers';
export function deploymentAddresses(evidence,manifest){
if(evidence?.status!=='BROADCAST_COMPLETE_RUNTIME_VERIFIED'){
  assert.notEqual(manifest.config.chainId,1,'Mainnet verification requires a complete runtime-verified broadcast report');
  return evidence;
}
assert.equal(evidence.releaseDigest,manifest.digest,'Broadcast report belongs to a different release');
assert.equal(evidence.chainId,manifest.config.chainId,'Broadcast report belongs to a different chain');
assert.equal(getAddress(evidence.deployer),getAddress(manifest.config.deployer),'Broadcast report used a different deployer');
assert.deepEqual(evidence.addresses,manifest.addresses,'Broadcast report addresses differ from the approved manifest');
return evidence.addresses;
}
export async function verifyRelease(manifestPath,addressesPath,rpcUrl,expectedDigest){
if(!manifestPath||!addressesPath||!rpcUrl)throw new Error('Usage: RPC_URL=... node tooling/verification/verify-release.mjs manifest.json broadcast-or-addresses.json');
const manifest=JSON.parse(await readFile(manifestPath,'utf8')),evidence=JSON.parse(await readFile(addressesPath,'utf8'));
const addresses=deploymentAddresses(evidence,manifest);
assert.deepEqual(manifest.mintProtection,mintProtection,'Mint protocol changed; prepare and approve a new release');
assert.deepEqual(manifest.artApproval,assertArtApproval(),'Artwork approval changed; rebuild the release');
const production=manifest.kind==='PRODUCTION'||manifest.config.chainId===1;
const {compiled,compiler,sourceHashes}=production?await verifyProductionInputs(manifest,expectedDigest):compileContracts({fixtures:false});
if(production)assert.deepEqual(addresses,manifest.addresses,'Deployment addresses differ from approved predictions');
assert.equal(manifest.compiler,compiler,'Compiler changed');
assert.deepEqual(manifest.sourceHashes,sourceHashes,'Sources changed since preparation; rebuild the release');
assert.deepEqual(manifest.catalog,catalogFingerprint(),'Catalog changed since preparation; rebuild the release');
const plan=deploymentPlan(manifest.config),artifacts={};
artifacts.SVGHeaderStore=artifactFor(compiled,'contracts/core/generated/SVGConstants.sol','SVGHeaderStore');
assert.deepEqual(manifest.banks,plan.banks,'Page plan changed');
assert.deepEqual(manifest.steps.map(({name,file,args})=>({name,file,args})),plan.steps,'Constructor plan changed');
for(const step of plan.steps){
  artifacts[step.name]=artifactFor(compiled,step.file,step.name);
  assert.deepEqual(manifest.steps.find(s=>s.name===step.name).artifact,artifacts[step.name],`Artifact changed: ${step.name}`);
}
const provider=new JsonRpcProvider(rpcUrl);
try{
  const report=await verifyDeployment({provider,plan,addresses,artifacts});
  if(production){
    report.releaseDigest=manifest.digest;report.runtimeHashes={};
    for(const item of [...manifest.steps,...manifest.internalContracts]){
      const actual=keccak256(await provider.getCode(item.address));assert.equal(actual,item.runtimeHash,`${item.name}: bound runtime hash mismatch`);
      report.runtimeHashes[item.name]={address:item.address,codeHash:actual};
    }
  }
  return {report,manifest,addresses};
}finally{provider.destroy();}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){const result=await verifyRelease(process.argv[2],process.argv[3],process.env.RPC_URL,process.argv[4]);console.log(JSON.stringify(result.report,null,2));}
