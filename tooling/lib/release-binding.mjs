import {mintProtection} from './mint-protocol.mjs';
import assert from 'node:assert/strict';
import {readFileSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ContractFactory,getAddress,getCreateAddress,isAddress,ZeroAddress,keccak256,toBeHex} from 'ethers';
import {compileContracts,artifactFor,compilerSettings,projectRoot} from './compile-contracts.mjs';
import {deploymentPlan,resolveArguments,catalogFingerprint} from './deployment-plan.mjs';
import {validateRoleAddresses} from './deployment-roles.mjs';
import {assertArtApproval} from '../verification/artwork-release-lock.mjs';
import {OPEN,GROUP} from '../../collection/source/art.js';
import {MAX_SUPPLY} from '../../collection/source/token-id.js';

export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const MAX_TRANSACTION_GAS_LIMIT=1n<<24n;
export const RELEASE_TOOL_FILES=Object.freeze([
  'collection/artwork/release-manifest.json',
  'tooling/config/mainnet-safe-policy.json',
  'tooling/verification/artwork-release-lock.mjs','tooling/lib/artwork.mjs','tooling/lib/check-generated.mjs','tooling/lib/compile-contracts.mjs',
  'tooling/lib/deployment-plan.mjs','tooling/lib/deployment-roles.mjs','tooling/lib/generate-banks.mjs','tooling/lib/generate-metadata.mjs',
  'tooling/lib/generated-text.mjs','tooling/lib/mint-protocol.mjs','tooling/release/prepare-release.mjs','tooling/release/register-deployment.mjs','tooling/lib/broadcast-release.mjs',
  'tooling/release/ledger-sign-intent.mjs','tooling/verification/live-health.mjs','tooling/verification/mainnet-fork.mjs','tooling/verification/run-mainnet-fork.mjs','tooling/release/mainnet-release.mjs','tooling/lib/mainnet-transactions.mjs','tooling/lib/release-binding.mjs','tooling/lib/release-paths.mjs','tooling/verification/release-preflight.mjs','tooling/lib/verify-deployment.mjs',
  'tooling/verification/prepare-static-analysis.mjs','tooling/verification/source-verification.mjs','tooling/lib/verify-header.mjs','tooling/verification/verify-release.mjs',
  'tooling/verification/verify-safe-policy.mjs','verification/storage-layout.mjs','verification/verify-standard-json.mjs',
  'collection/source/art.js','collection/source/artwork-validation.js','collection/generated/bead-data.js','collection/catalog/catalog.json','apps/web/src/chain-core.js','collection/source/editorial.js','collection/source/metadata.js','collection/source/token-id.js'
]);
export function productionReleaseFiles(trackedFiles){
  const material=new Set(RELEASE_TOOL_FILES);
  return [...new Set(trackedFiles)].filter(file=>file.startsWith('contracts/')||file.startsWith('collection/artwork/traits/')||material.has(file)).sort();
}
export function canonicalJSON(value){
  if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalJSON(value[k])).join(',')+'}';
  const encoded=JSON.stringify(value);assert.notEqual(encoded,undefined,'Release data must be JSON');return encoded;
}
export function releaseDigest(manifest){const {digest,...payload}=manifest;return sha256(canonicalJSON(payload));}

export function sourceIdentity(root=projectRoot,materialFiles){
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
  assert.equal(realpathSync(git('rev-parse','--show-toplevel')),realpathSync(root),'Release root must be the repository root');
  assert.equal(git('status','--porcelain=v1','--untracked-files=all'),'','Production release requires a clean tracked and untracked working tree');
  const hashFile=file=>sha256(readFileSync(path.join(root,file)));
  const trackedFiles=git('ls-files').split('\n').filter(Boolean);
  const toolingFiles=materialFiles?[...new Set(materialFiles)].sort():productionReleaseFiles(trackedFiles);
  for(const file of toolingFiles)assert.ok(trackedFiles.includes(file),`Production release file is not tracked: ${file}`);
  if(!materialFiles)for(const file of RELEASE_TOOL_FILES)assert.ok(toolingFiles.includes(file),`Missing production release file: ${file}`);
  return {commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),dirtyPolicy:'REJECT_TRACKED_AND_UNTRACKED',
    packageLockHash:hashFile('package-lock.json'),packageHash:hashFile('package.json'),
    toolchain:{node:process.version,npm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim(),
      solcPackage:JSON.parse(readFileSync(path.join(root,'node_modules/solc/package.json'),'utf8')).version,
      soljsonHash:hashFile('node_modules/solc/soljson.js')},
    toolingHashes:Object.fromEntries(toolingFiles.map(file=>[file,hashFile(file)]))};
}

export function validateProductionConfig(config,plan=deploymentPlan(config)){
  assert.equal(config.kind,'PRODUCTION','Explicit kind PRODUCTION required');
  const keys=['kind','chainId','initialOwner','treasury','royaltyReceiver','royaltyBps','saleCap','deployer','nonce',
    'roleCodeHashes','treasuryProbeWei','gasLimits','maxFeePerGas','maxPriorityFeePerGas','balanceBufferWei'];
  assert.deepEqual(Object.keys(config).sort(),keys.sort(),'Production config requires exactly the documented explicit fields');
  assert.ok(isAddress(config.deployer)&&getAddress(config.deployer)!==ZeroAddress,'Invalid deployer');
  assert.ok(Number.isSafeInteger(config.nonce)&&config.nonce>=0&&config.nonce+plan.steps.length<Number.MAX_SAFE_INTEGER,'Invalid deployment nonce');
  const decimal=(v,name,positive=false)=>{
    assert.ok(typeof v==='string'&&/^(0|[1-9][0-9]*)$/.test(v),`${name}: decimal integer string required`);
    const n=BigInt(v);assert.ok(n<1n<<256n&&(!positive||n>0n),`${name}: invalid amount`);return n;
  };
  decimal(config.treasuryProbeWei,'treasuryProbeWei',true);decimal(config.balanceBufferWei,'balanceBufferWei');
  assert.ok(decimal(config.maxFeePerGas,'maxFeePerGas',true)>=decimal(config.maxPriorityFeePerGas,'maxPriorityFeePerGas'),'Priority fee exceeds max fee');
  assert.deepEqual(Object.keys(config.gasLimits||{}).sort(),plan.steps.map(s=>s.name).sort(),'Explicit gas limit required for every deployment step');
  for(const [name,limit] of Object.entries(config.gasLimits))assert.ok(decimal(limit,`gasLimits.${name}`,true)<=MAX_TRANSACTION_GAS_LIMIT,`${name}: gas limit exceeds the EIP-7825 transaction cap`);
  assert.deepEqual(Object.keys(config.roleCodeHashes||{}).sort(),['initialOwner','treasury','royaltyReceiver'].sort(),'Explicit role code hashes required');
  for(const value of Object.values(config.roleCodeHashes))assert.match(value,/^0x[0-9a-f]{64}$/,'Invalid role code hash');
  return config;
}

// Bind every compiler-declared immutable slot by AST declaration, never by hand offsets.
export function boundRuntime(compiled,artifact,values){
  const declarations=new Map();
  const visit=node=>{if(!node||typeof node!=='object')return;if(node.nodeType==='VariableDeclaration')declarations.set(String(node.id),node.name);
    for(const v of Object.values(node))if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')visit(v);};
  for(const source of Object.values(compiled.sources))visit(source.ast);
  const runtime=Buffer.from(artifact.deployedBytecode.slice(2),'hex');
  for(const [id,slots] of Object.entries(artifact.immutableReferences||{})){
    const name=declarations.get(id);assert.ok(Object.hasOwn(values,name),`Missing immutable binding ${artifact.contractName}.${name}`);
    for(const {start,length} of slots){assert.ok(start>=0&&start+length<=runtime.length,'Invalid immutable range');Buffer.from(toBeHex(BigInt(values[name]),length).slice(2),'hex').copy(runtime,start);}
  }
  return '0x'+runtime.toString('hex');
}

export async function resolvedDeployment(compiled,plan){
  const config=validateProductionConfig(plan.config,plan),addresses={};
  for(const [i,step] of plan.steps.entries())addresses[step.name]=getCreateAddress({from:config.deployer,nonce:config.nonce+i});
  const headerStore=getCreateAddress({from:addresses.GenotypeDescriptor,nonce:1});
  const header=Buffer.from(OPEN+GROUP);assert.equal(header.length,(OPEN+GROUP).length,'Header must remain ASCII');
  const pages=[];for(let offset=0;offset<header.length;offset+=20000)pages.push({name:`SVGHeaderPage${pages.length}`,address:getCreateAddress({from:headerStore,nonce:pages.length+1}),runtimeCode:'0x'+header.subarray(offset,offset+20000).toString('hex')});
  const allAddresses={...addresses,SVGHeaderStore:headerStore,...Object.fromEntries(pages.map(p=>[p.name,p.address]))};
  const sharedRoles=validateRoleAddresses(config,allAddresses);
  assert.ok(!Object.values(allAddresses).some(a=>a.toLowerCase()===config.deployer.toLowerCase()),'Deployer collides with deployment');
  const steps=[];
  for(const [i,step] of plan.steps.entries()){
    const artifact=artifactFor(compiled,step.file,step.name),args=resolveArguments(step.args,addresses);
    const values={genotypeDescriptor:addresses.GenotypeDescriptor,phenotypeRenderer:addresses.PhenotypeRenderer,treasury:config.treasury,
      saleCap:config.saleCap,encoder:addresses.MetadataEncoder,combinations:MAX_SUPPLY,headerStore};
    if(Array.isArray(args[0]))args[0].forEach((v,j)=>values[`page${j}`]=v);
    const runtimeCode=boundRuntime(compiled,artifact,values);
    const {data:initcode}=await new ContractFactory(artifact.abi,artifact.bytecode).getDeployTransaction(...args);
    assert.ok((initcode.length-2)/2<=49152,`${step.name}: initcode exceeds EIP-3860`);
    const deps=[];const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(typeof v==='string'&&v.startsWith('$'))deps.push(v.slice(1));};walk(step.args);
    steps.push({...step,artifact,address:addresses[step.name],nonce:config.nonce+i,resolvedArgs:args,dependencies:deps,
      initcode,initcodeHash:keccak256(initcode),creationCodeHash:keccak256(artifact.bytecode),runtimeTemplateHash:keccak256(artifact.deployedBytecode),runtimeCode,runtimeHash:keccak256(runtimeCode)});
  }
  const storeArtifact=artifactFor(compiled,'contracts/core/generated/SVGConstants.sol','SVGHeaderStore');
  const storeCode=boundRuntime(compiled,storeArtifact,Object.fromEntries(pages.map((p,i)=>[`page${i}`,p.address])));
  const internalContracts=[{name:'SVGHeaderStore',address:headerStore,runtimeCode:storeCode},...pages].map(item=>({...item,runtimeHash:keccak256(item.runtimeCode)}));
  return {addresses,sharedRoles,steps,internalContracts};
}

export async function productionManifest(config,compilation,source){
  const plan=deploymentPlan(config),resolved=await resolvedDeployment(compilation.compiled,plan);
  const payload={mintProtection,format:2,kind:'PRODUCTION',status:'PREPARED_NOT_DEPLOYED',source,compiler:compilation.compiler,compilerSettings,
    config,artApproval:assertArtApproval(),catalog:catalogFingerprint(),sourceHashes:compilation.sourceHashes,
    generatedSourceHashes:Object.fromEntries(Object.entries(compilation.sourceHashes).filter(([f])=>f.startsWith('contracts/core/generated/'))),banks:plan.banks,...resolved};
  return {...payload,digest:releaseDigest(payload)};
}

export function assertApprovedDigest(manifest,expectedDigest){
  assert.ok(typeof expectedDigest==='string'&&/^[0-9a-f]{64}$/.test(expectedDigest),'Supply an independently approved --expected-release SHA-256 digest');
  assert.equal(manifest.format,2,'Production manifest format 2 required');assert.equal(manifest.kind,'PRODUCTION','Production manifest required');
  assert.equal(manifest.digest,expectedDigest,'Manifest is not the independently approved release');
  assert.equal(releaseDigest(manifest),expectedDigest,'Manifest content differs from approved digest');
}

export async function verifyProductionInputs(manifest,expectedDigest){
  assertApprovedDigest(manifest,expectedDigest);
  const source=sourceIdentity();assert.deepEqual(source,manifest.source,'Git revision/tree, toolchain or source files changed');
  const compilation=compileContracts({fixtures:false});
  const fresh=await productionManifest(manifest.config,compilation,source);
  assert.deepEqual(manifest,fresh,'Production inputs/artifacts/addresses changed; prepare and independently approve a new release');
  return compilation;
}
