import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {chmod,mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
import {assertArtApproval} from './artwork-release-lock.mjs';
import {compilerSettings,projectRoot} from '../lib/compile-contracts.mjs';
import {deploymentPlan} from '../lib/deployment-plan.mjs';
import {assertExternalOutput} from '../lib/release-paths.mjs';

export const ARCHITECTURE_EQUIVALENCE_KIND='MYCELIUM_ARCHITECTURE_EQUIVALENCE';
const HASH=/^[0-9a-f]{64}$/;
const COMMIT=/^[0-9a-f]{40}$/;
const BASELINE_ROOT='contracts/';
const CANDIDATE_ROOT='contracts/core/';
const REQUIRED_GATES=Object.freeze([
  'productionSoliditySources','generatedSoliditySources','compilerArtifacts','deploymentSemantics','canonicalArtwork','artworkReleaseLock'
]);
const MAX_BUFFER=128*1024*1024;
const sha256=value=>createHash('sha256').update(value).digest('hex');
const canonicalJSON=value=>{
  if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJSON(value[key])).join(',')+'}';
  const encoded=JSON.stringify(value);assert.notEqual(encoded,undefined,'Equivalence evidence must be JSON');return encoded;
};
const git=(args,options={})=>execFileSync('git',['-C',projectRoot,...args],{maxBuffer:MAX_BUFFER,...options});
const gitText=(...args)=>git(args,{encoding:'utf8'}).trim();
const gitFile=(commit,file)=>git(['show',`${commit}:${file}`]);
const gitFileText=(commit,file)=>gitFile(commit,file).toString('utf8');
const listCommitFiles=(commit,prefix)=>git(['ls-tree','-r','-z','--name-only',commit,'--',prefix],{encoding:'utf8'}).split('\0').filter(Boolean).sort();
const mappedCandidatePath=baseline=>CANDIDATE_ROOT+baseline.slice(BASELINE_ROOT.length);
const normalizedStructuralPaths=value=>value.replaceAll(CANDIDATE_ROOT,BASELINE_ROOT).replaceAll('tests/contracts/core/fixtures/','tests/fixtures/');
const normalizedValue=value=>{
  if(Array.isArray(value))return value.map(normalizedValue);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[normalizedStructuralPaths(key),normalizedValue(item)]));
  return typeof value==='string'?normalizedStructuralPaths(value):value;
};
const equalHash=value=>sha256(Buffer.isBuffer(value)?value:canonicalJSON(value));

function resolveCommit(value,label){
  assert.ok(value,`${label} commit is required`);
  const resolved=gitText('rev-parse','--verify',`${value}^{commit}`);
  assert.match(resolved,COMMIT,`Invalid ${label} commit`);
  return resolved;
}

function assertCandidateCheckout(candidateCommit){
  assert.equal(gitText('rev-parse','HEAD'),candidateCommit,'Candidate must be the checked-out HEAD');
  assert.equal(gitText('status','--porcelain=v1','--untracked-files=all'),'','Architecture equivalence requires a clean tracked and untracked checkout');
}

function assertAncestry(baselineCommit,candidateCommit){
  const result=spawnSync('git',['-C',projectRoot,'merge-base','--is-ancestor',baselineCommit,candidateCommit],{encoding:'utf8'});
  assert.equal(result.status,0,`Baseline ${baselineCommit} is not an ancestor of candidate ${candidateCommit}`);
}

function packageIdentity(commit,name){
  const lock=JSON.parse(gitFileText(commit,'package-lock.json'));
  const item=lock.packages?.[`node_modules/${name}`];
  assert.ok(item,`${name} is absent from ${commit}:package-lock.json`);
  return {version:item.version,integrity:item.integrity};
}

function sourcePairs(baselineCommit,candidateCommit){
  const baseline=listCommitFiles(baselineCommit,'contracts').filter(file=>file.endsWith('.sol'));
  const candidate=listCommitFiles(candidateCommit,'contracts/core').filter(file=>file.endsWith('.sol'));
  assert.ok(baseline.length>0,'Baseline has no production Solidity sources');
  assert.deepEqual(candidate,baseline.map(mappedCandidatePath),'Production Solidity source inventory changed outside the structural move');
  return baseline.map(baselineFile=>({baselineFile,candidateFile:mappedCandidatePath(baselineFile)}));
}

function compareSourceContent(pairs,baselineCommit,candidateCommit){
  return pairs.map(({baselineFile,candidateFile})=>{
    const baseline=gitFile(baselineCommit,baselineFile),candidate=gitFile(candidateCommit,candidateFile);
    assert.deepEqual(candidate,baseline,`${candidateFile}: Solidity content differs from ${baselineFile}`);
    return {baseline:baselineFile,candidate:candidateFile,sha256:sha256(baseline)};
  });
}

function importsOf(content){
  return [...content.matchAll(/import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]\s*;/g)].map(match=>match[1]);
}

function snapshotCompilerInput(commit,roots,repositoryRoot){
  const sources=new Map(),queue=[...roots].sort();
  while(queue.length){
    const file=queue.shift();if(sources.has(file))continue;
    let content;
    if(file.startsWith('@'))content=readFileSync(path.join(projectRoot,'node_modules',file),'utf8');
    else{
      assert.ok(file.startsWith(repositoryRoot),`Production import escapes ${repositoryRoot}: ${file}`);
      content=gitFileText(commit,file);
    }
    sources.set(file,{content});
    for(const imported of importsOf(content)){
      const resolved=imported.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),imported)):imported;
      if(!sources.has(resolved))queue.push(resolved);
    }
    queue.sort();
  }
  const settings=structuredClone(compilerSettings);
  settings.metadata={bytecodeHash:'none',appendCBOR:false};
  return {language:'Solidity',sources:Object.fromEntries([...sources].sort(([a],[b])=>a.localeCompare(b))),settings};
}

function compileSnapshot(input,label){
  const compiled=JSON.parse(solc.compile(JSON.stringify(input)));
  const errors=(compiled.errors||[]).filter(item=>item.severity==='error');
  assert.deepEqual(errors,[],`${label} metadata-free compilation failed:\n${errors.map(item=>item.formattedMessage).join('\n')}`);
  return compiled;
}

function declarationNames(compiled){
  const names=new Map();
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    if(node.nodeType==='VariableDeclaration')names.set(String(node.id),node.canonicalName||node.name);
    for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  };
  for(const source of Object.values(compiled.sources||{}))visit(source.ast);
  return names;
}

function normalizedImmutables(artifact,names){
  return Object.entries(artifact.evm.deployedBytecode.immutableReferences||{}).map(([id,slots])=>({
    declaration:names.get(id)||`UNKNOWN_AST_${id}`,
    slots:[...slots].map(slot=>({start:slot.start,length:slot.length})).sort((a,b)=>a.start-b.start||a.length-b.length)
  })).sort((a,b)=>a.declaration.localeCompare(b.declaration));
}

function normalizedStorage(layout){
  return normalizedValue({
    storage:(layout.storage||[]).map(({astId,...entry})=>entry),
    types:layout.types||null
  });
}

function bytecodeHash(hex,label){
  assert.match(hex,/^(?:[0-9a-fA-F]{2})*$/,`${label}: invalid bytecode`);
  return sha256(Buffer.from(hex,'hex'));
}

function compareArtifacts(pairs,baselineCompiled,candidateCompiled){
  const baselineNames=declarationNames(baselineCompiled),candidateNames=declarationNames(candidateCompiled),artifacts=[];
  for(const {baselineFile,candidateFile} of pairs){
    const baselineContracts=baselineCompiled.contracts?.[baselineFile]||{},candidateContracts=candidateCompiled.contracts?.[candidateFile]||{};
    assert.deepEqual(Object.keys(candidateContracts).sort(),Object.keys(baselineContracts).sort(),`${candidateFile}: contract definitions changed`);
    for(const name of Object.keys(baselineContracts).sort()){
      const baseline=baselineContracts[name],candidate=candidateContracts[name];
      const fields={
        abi:baseline.abi,
        storageLayout:normalizedStorage(baseline.storageLayout),
        immutableReferences:normalizedImmutables(baseline,baselineNames),
        constructorDefinition:baseline.abi.find(item=>item.type==='constructor')||null
      };
      const candidateFields={
        abi:candidate.abi,
        storageLayout:normalizedStorage(candidate.storageLayout),
        immutableReferences:normalizedImmutables(candidate,candidateNames),
        constructorDefinition:candidate.abi.find(item=>item.type==='constructor')||null
      };
      assert.deepEqual(candidateFields,fields,`${candidateFile}:${name}: ABI, storage, immutables or constructor changed`);
      const creation=baseline.evm.bytecode.object,runtime=baseline.evm.deployedBytecode.object;
      assert.equal(candidate.evm.bytecode.object,creation,`${candidateFile}:${name}: metadata-free creation bytecode changed`);
      assert.equal(candidate.evm.deployedBytecode.object,runtime,`${candidateFile}:${name}: metadata-free runtime bytecode changed`);
      artifacts.push({baselineSource:baselineFile,candidateSource:candidateFile,contract:name,
        abiSha256:equalHash(fields.abi),storageLayoutSha256:equalHash(fields.storageLayout),
        immutableReferencesSha256:equalHash(fields.immutableReferences),constructorDefinitionSha256:equalHash(fields.constructorDefinition),
        metadataFreeCreationSha256:bytecodeHash(creation,`${baselineFile}:${name}`),metadataFreeCreationBytes:creation.length/2,
        metadataFreeRuntimeSha256:bytecodeHash(runtime,`${baselineFile}:${name}`),metadataFreeRuntimeBytes:runtime.length/2});
    }
  }
  return artifacts;
}

function compareDeploymentSemantics(baselineCommit,candidateCommit){
  const baselineFile='tooling/lib/deployment-plan.mjs',candidateFile='tooling/lib/deployment-plan.mjs';
  const baseline=gitFileText(baselineCommit,baselineFile),candidate=normalizedStructuralPaths(gitFileText(candidateCommit,candidateFile));
  assert.equal(candidate,baseline,'Deployment-plan semantics changed beyond scoped source paths');
  const config={chainId:1,initialOwner:'0x1000000000000000000000000000000000000001',treasury:'0x2000000000000000000000000000000000000002',
    royaltyReceiver:'0x2000000000000000000000000000000000000002',royaltyBps:500,saleCap:1000};
  const plan=deploymentPlan(config),normalizedPlan=normalizedValue({banks:plan.banks,steps:plan.steps});
  return {baselineSource:baselineFile,candidateSource:candidateFile,normalizedSourceSha256:sha256(baseline),
    normalizedPlanSha256:equalHash(normalizedPlan),deploymentSteps:plan.steps.length,normalizedPlan};
}

function canonicalArtworkFiles(commit){
  const files=listCommitFiles(commit,'collection');
  const selected=files.filter(file=>file==='collection/artwork/release-manifest.json'||file.startsWith('collection/artwork/traits/')||
    file==='collection/catalog/catalog.json'||file==='collection/generated/bead-data.js'||file.startsWith('collection/source/'));
  selected.push('tooling/lib/generate-metadata.mjs');
  return [...new Set(selected)].sort();
}

function compareCanonicalArtwork(baselineCommit,candidateCommit){
  const baseline=canonicalArtworkFiles(baselineCommit),candidate=canonicalArtworkFiles(candidateCommit);
  assert.deepEqual(candidate,baseline,'Canonical artwork source inventory changed');
  const hashes={};
  for(const file of baseline){
    const before=gitFile(baselineCommit,file),after=gitFile(candidateCommit,file);
    assert.deepEqual(after,before,`${file}: canonical artwork, catalog or editorial content changed`);
    hashes[file]=sha256(before);
  }
  return {fileCount:baseline.length,inventorySha256:equalHash(hashes)};
}

function evidencePayload({baselineCommit,candidateCommit,pairs,sourceComparisons,artifacts,deployment,artwork,artApproval,dependencyIdentity,dependencySourcesSha256}){
  const productionSources={equivalent:true,count:sourceComparisons.length,files:sourceComparisons};
  const generated=sourceComparisons.filter(item=>item.baseline.includes('/generated/'));
  const gates={
    productionSoliditySources:productionSources,
    generatedSoliditySources:{equivalent:true,count:generated.length,files:generated},
    compilerArtifacts:{equivalent:true,count:artifacts.length,artifacts},
    deploymentSemantics:{equivalent:true,...deployment},
    canonicalArtwork:{equivalent:true,...artwork},
    artworkReleaseLock:{equivalent:true,format:3,status:'CURRENT_RELEASE_LOCK',catalogSha256:artApproval.catalogSha256}
  };
  const allEquivalent=REQUIRED_GATES.every(name=>gates[name]?.equivalent===true);
  assert.equal(allEquivalent,true,'A required architecture-equivalence gate failed');
  return {format:1,kind:ARCHITECTURE_EQUIVALENCE_KIND,baselineCommit,candidateCommit,
    comparison:'STRUCTURAL_PATH_MIGRATION_METADATA_FREE_EXECUTABLE_EQUIVALENCE',
    pathMapping:{baseline:BASELINE_ROOT,candidate:CANDIDATE_ROOT},
    toolchain:{compiler:solc.version(),soljsonSha256:sha256(readFileSync(path.join(projectRoot,'node_modules/solc/soljson.js'))),
      compilerSettings:{...structuredClone(compilerSettings),metadata:{bytecodeHash:'none',appendCBOR:false}},dependencies:dependencyIdentity,
      dependencySourcesSha256},
    sourcePairCount:pairs.length,gates,allEquivalent};
}

export function assertArchitectureEquivalenceEvidence(evidence,{expectedCandidate}={}){
  assert.equal(evidence?.format,1,'Architecture-equivalence evidence format 1 required');
  assert.equal(evidence?.kind,ARCHITECTURE_EQUIVALENCE_KIND,'Architecture-equivalence evidence kind is invalid');
  assert.match(evidence.baselineCommit,COMMIT,'Full baseline commit required');
  assert.match(evidence.candidateCommit,COMMIT,'Full candidate commit required');
  if(expectedCandidate)assert.equal(evidence.candidateCommit,expectedCandidate,'Equivalence evidence is for another candidate');
  assert.equal(evidence.allEquivalent,true,'Executable equivalence must pass before capsule export');
  assert.deepEqual(Object.keys(evidence.gates||{}).sort(),[...REQUIRED_GATES].sort(),'Architecture-equivalence evidence has incomplete gates');
  for(const name of REQUIRED_GATES)assert.equal(evidence.gates[name].equivalent,true,`${name} equivalence did not pass`);
  assert.match(evidence.evidenceSha256,HASH,'Architecture-equivalence evidence digest is missing');
  const {evidenceSha256,...payload}=evidence;
  assert.equal(evidenceSha256,sha256(canonicalJSON(payload)),'Architecture-equivalence evidence digest differs');
  return evidence;
}

export function buildArchitectureEquivalence({baseline,candidate}){
  const baselineCommit=resolveCommit(baseline,'Baseline'),candidateCommit=resolveCommit(candidate,'Candidate');
  assertCandidateCheckout(candidateCommit);assertAncestry(baselineCommit,candidateCommit);
  const dependencyIdentity={
    solc:packageIdentity(candidateCommit,'solc'),openzeppelin:packageIdentity(candidateCommit,'@openzeppelin/contracts')
  };
  assert.deepEqual(dependencyIdentity.solc,packageIdentity(baselineCommit,'solc'),'Pinned solc dependency changed since baseline');
  assert.deepEqual(dependencyIdentity.openzeppelin,packageIdentity(baselineCommit,'@openzeppelin/contracts'),'Pinned OpenZeppelin dependency changed since baseline');
  assert.equal(dependencyIdentity.solc.version,solc.version().split('+')[0],'Installed solc differs from candidate lockfile');
  const pairs=sourcePairs(baselineCommit,candidateCommit),sourceComparisons=compareSourceContent(pairs,baselineCommit,candidateCommit);
  const baselineInput=snapshotCompilerInput(baselineCommit,pairs.map(item=>item.baselineFile),BASELINE_ROOT);
  const candidateInput=snapshotCompilerInput(candidateCommit,pairs.map(item=>item.candidateFile),CANDIDATE_ROOT);
  const dependencySources=Object.fromEntries(Object.entries(candidateInput.sources).filter(([file])=>file.startsWith('@')).map(([file,{content}])=>[file,sha256(content)]));
  const baselineDependencySources=Object.fromEntries(Object.entries(baselineInput.sources).filter(([file])=>file.startsWith('@')).map(([file,{content}])=>[file,sha256(content)]));
  assert.deepEqual(dependencySources,baselineDependencySources,'Resolved compiler dependency sources changed between comparisons');
  const baselineCompiled=compileSnapshot(baselineInput,'Baseline'),candidateCompiled=compileSnapshot(candidateInput,'Candidate');
  const artifacts=compareArtifacts(pairs,baselineCompiled,candidateCompiled);
  const payload=evidencePayload({baselineCommit,candidateCommit,pairs,sourceComparisons,artifacts,
    deployment:compareDeploymentSemantics(baselineCommit,candidateCommit),artwork:compareCanonicalArtwork(baselineCommit,candidateCommit),
    artApproval:assertArtApproval(),dependencyIdentity,dependencySourcesSha256:equalHash(dependencySources)});
  return assertArchitectureEquivalenceEvidence({...payload,evidenceSha256:sha256(canonicalJSON(payload))},{expectedCandidate:candidateCommit});
}

export async function writeArchitectureEquivalence({baseline,candidate,output}){
  assertExternalOutput(output);assert.ok(!existsSync(output),'Architecture-equivalence output must not already exist');
  const evidence=buildArchitectureEquivalence({baseline,candidate}),resolved=path.resolve(output),temporary=`${resolved}.${process.pid}.tmp`;
  await mkdir(path.dirname(resolved),{recursive:true});
  await writeFile(temporary,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,resolved);await chmod(resolved,0o600);
  return {evidence,path:resolved};
}

export async function verifyArchitectureEquivalenceEvidence(evidence,{expectedCandidate}={}){
  assertArchitectureEquivalenceEvidence(evidence,{expectedCandidate});
  const regenerated=buildArchitectureEquivalence({baseline:evidence.baselineCommit,candidate:evidence.candidateCommit});
  assert.deepEqual(evidence,regenerated,'Architecture-equivalence evidence does not match a fresh comparison');
  return evidence;
}

export async function verifyArchitectureEquivalenceFile(file,{expectedCandidate}={}){
  const evidence=JSON.parse(await readFile(file,'utf8'));
  await verifyArchitectureEquivalenceEvidence(evidence,{expectedCandidate});
  return evidence;
}

function valueAfter(args,flag){const index=args.indexOf(flag);return index<0?undefined:args[index+1];}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [command,...args]=process.argv.slice(2);
  if(command==='generate'){
    const baseline=valueAfter(args,'--baseline'),candidate=valueAfter(args,'--candidate'),output=valueAfter(args,'--output');
    assert.ok(baseline&&candidate&&output,'Usage: architecture-equivalence.mjs generate --baseline COMMIT --candidate COMMIT --output /absolute/external/architecture-equivalence.json');
    const result=await writeArchitectureEquivalence({baseline,candidate,output});
    console.log(`PASS architecture equivalence: ${result.evidence.gates.compilerArtifacts.count} artifacts, ${result.evidence.sourcePairCount} Solidity sources, candidate ${result.evidence.candidateCommit}.`);
    console.log(`Evidence: ${result.path} · ${result.evidence.evidenceSha256}. No network request sent.`);
  }else if(command==='verify'){
    const [file]=args;assert.ok(file,'Usage: architecture-equivalence.mjs verify /absolute/external/architecture-equivalence.json');
    const evidence=await verifyArchitectureEquivalenceFile(file);
    console.log(`PASS architecture-equivalence evidence regenerated for ${evidence.candidateCommit}: ${evidence.evidenceSha256}.`);
  }else throw Error('Usage: architecture-equivalence.mjs generate --baseline COMMIT --candidate COMMIT --output /absolute/external/file.json | verify /absolute/external/file.json');
}
