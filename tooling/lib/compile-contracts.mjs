import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import solc from 'solc';
import {assertGeneratedSources} from './check-generated.mjs';
export const projectRoot=fileURLToPath(new URL('../../',import.meta.url));
// Keep the legacy EVM optimizer, but disable its Yul pass until a stable solc
// release containing the SOL-2026-7 fix is available and reviewed.
export const compilerSettings={optimizer:{enabled:true,runs:200,details:{yul:false}},viaIR:false,evmVersion:'shanghai',outputSelection:{'*':{'':['ast'],'*':['abi','evm.bytecode.object','evm.deployedBytecode.object','evm.deployedBytecode.immutableReferences','storageLayout']}}};
export const productionSources=['MyceliumFriends','GenotypeDescriptor','IArtBank','BeadCodec','PairBase64','MintPricing','MintSettlement','MetadataEncoder','IPhenotypeSource','PhenotypeRenderer'].map(name=>`contracts/core/${name}.sol`).concat(['GenomeSchema','ArtBanks','SVGConstants','MetadataContent'].map(name=>`contracts/core/generated/${name}.sol`));
export function standardCompilerInput({fixtures=false}={}){
  const roots=fixtures?productionSources.concat(['ProtectionFixtures','SettlementFixtures','MintFixtures','RendererFixtures','PhaseOneFixtures','RoyaltyFixtures'].map(name=>`tests/contracts/core/fixtures/${name}.sol`)):productionSources;
  const sources={},queue=[...roots];
  while(queue.length){
    const file=queue.shift();if(Object.hasOwn(sources,file))continue;
    const resolved=path.join(projectRoot,file.startsWith('@')?'node_modules':'',file),content=readFileSync(resolved,'utf8');sources[file]={content};
    const imports=[...content.matchAll(/import\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]\s*;/g)].map(match=>match[1]);
    for(const imported of imports){
      const name=imported.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(file),imported)):imported;
      if(!Object.hasOwn(sources,name))queue.push(name);
    }
  }
  return {language:'Solidity',sources,settings:compilerSettings};
}
export function compileContracts({fixtures=true,sourceOverrides={}}={}){
  assertGeneratedSources();
  const files=fixtures?productionSources.concat(['ProtectionFixtures','SettlementFixtures','MintFixtures','RendererFixtures','PhaseOneFixtures','RoyaltyFixtures'].map(name=>`tests/contracts/core/fixtures/${name}.sol`)):productionSources;
  const loaded=new Map();
  const read=file=>{const resolved=path.join(projectRoot,file.startsWith('@')?'node_modules':'',file);const content=sourceOverrides[file]??readFileSync(resolved,'utf8');loaded.set(file,content);return content;};
  const sources=Object.fromEntries(files.map(file=>[file,{content:read(file)}]));
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:compilerSettings}),{import:file=>{try{return{contents:read(file)}}catch{return{error:`Import not found: ${file}`}}}}));
  const errors=(compiled.errors||[]).filter(e=>e.severity==='error');if(errors.length)throw new Error(errors.map(e=>e.formattedMessage).join('\n'));
  for(const warning of compiled.errors||[])console.log(warning.formattedMessage);
  return {compiled,compiler:solc.version(),sourceHashes:Object.fromEntries([...loaded].sort(([a],[b])=>a.localeCompare(b)).map(([name,content])=>[name,createHash('sha256').update(content).digest('hex')]))};
}
export function artifactFor(compiled,file,name){
  const artifact=compiled.contracts[file][name];
  if(artifact.evm.deployedBytecode.object.length/2>24576)throw new Error(`${name} exceeds EIP-170`);
  if(artifact.evm.bytecode.object.length/2>49152)throw new Error(`${name} initcode exceeds EIP-3860 before constructor arguments`);
  return {contractName:name,compiler:solc.version(),abi:artifact.abi,storageLayout:artifact.storageLayout,bytecode:'0x'+artifact.evm.bytecode.object,deployedBytecode:'0x'+artifact.evm.deployedBytecode.object,immutableReferences:artifact.evm.deployedBytecode.immutableReferences};
}
