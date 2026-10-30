import {mintProtection} from '../lib/mint-protocol.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {ContractFactory,keccak256} from 'ethers';
import {compileContracts,artifactFor} from '../lib/compile-contracts.mjs';
import {deploymentPlan,catalogFingerprint} from '../lib/deployment-plan.mjs';
import {assertArtApproval} from '../verification/artwork-release-lock.mjs';
import {productionManifest,sourceIdentity} from '../lib/release-binding.mjs';
import {assertExternalOutput} from '../lib/release-paths.mjs';
const configPath=process.argv[2],outputDir=process.argv[3]||'output/release';
if(!configPath)throw new Error('Usage: node tooling/release/prepare-release.mjs path/to/deployment-config.json (see docs/contracts/core/architecture/MINTING.md)');
const plan=deploymentPlan(JSON.parse(await readFile(configPath,'utf8')));
if(plan.config.chainId===1&&plan.config.kind!=='PRODUCTION')throw new Error('Mainnet requires explicit PRODUCTION release binding');
const production=plan.config.kind==='PRODUCTION';
if(production)assertExternalOutput(process.argv[3]);
const source=production?sourceIdentity():null;
const artApproval=assertArtApproval();
const {compiled,compiler,sourceHashes}=compileContracts({fixtures:false});
const steps=[];
for(const step of plan.steps){
  const artifact=artifactFor(compiled,step.file,step.name);
  // Constructor arguments count towards EIP-3860; symbolic addresses have fixed encoded length.
  const fake=args=>args.map(v=>Array.isArray(v)?fake(v):typeof v==='string'&&v.startsWith('$')?'0x0000000000000000000000000000000000000001':v);
  const transaction=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(...fake(step.args));
  if((transaction.data.length-2)/2>49152)throw new Error(`${step.name}: deployment initcode exceeds EIP-3860`);
  steps.push({...step,artifact,creationCodeHash:keccak256(artifact.bytecode)});
}
const manifest=production?await productionManifest(plan.config,{compiled,compiler,sourceHashes},source):
  {mintProtection,format:1,status:'PREPARED_NOT_DEPLOYED',compiler,config:plan.config,artApproval,catalog:catalogFingerprint(),sourceHashes,banks:plan.banks,steps};
if(production){
  const {default:assert}=await import('node:assert/strict');assert.deepEqual(sourceIdentity(),source,'Sources changed during preparation');
  console.log(`Candidate production digest: ${manifest.digest}. This is NOT independent approval; review and approve it before preflight.`);
}
await mkdir(outputDir,{recursive:true});
await writeFile(`${outputDir}/manifest.json`,JSON.stringify(manifest,null,2)+'\n');
console.log(`Prepared ${steps.length} deployments for chain ${plan.config.chainId}; catalog ${manifest.catalog.sha256}. No transactions sent.`);
