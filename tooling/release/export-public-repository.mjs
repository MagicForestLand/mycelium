import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectRoot} from '../lib/compile-contracts.mjs';
import {assertExternalOutput} from '../lib/release-paths.mjs';
import {assertRepositoryReferences} from '../lib/repository-references.mjs';

const SPEC_PATH='tooling/config/public-repository.json';
const sha256=value=>createHash('sha256').update(value).digest('hex');
const SECRET_RULES=Object.freeze([
  ['raw private-key field',/(?:(?:"|')?(?:privateKey|secretKey)(?:"|')?\s*[:=]\s*(?:"|'))(?:0x)?[0-9a-f]{64}(?:"|')/i],
  ['mnemonic field',/(?:(?:"|')?(?:mnemonic|seedPhrase|recoveryPhrase)(?:"|')?\s*[:=]\s*(?:"|'))[^\n"']{20,}(?:"|')/i],
  ['wallet keystore',/"(?:crypto|Crypto)"\s*:\s*\{[\s\S]{0,3000}"ciphertext"\s*:/i]
]);
const FORBIDDEN_PATHS=[
  /(^|\/)\.git(?:\/|$)/,/(^|\/)\.dev(?:\/|$)/,/(^|\/)node_modules(?:\/|$)/,/(^|\/)output(?:\/|$)/,
  /(^|\/)\.env(?:\.|$)/,/(^|\/)(?:ui_context\.txt|mycelium-code-review\.zip)$/
];

const git=(...args)=>execFileSync('git',['-C',projectRoot,...args],{encoding:'utf8'}).trim();
const normalized=value=>{
  assert.equal(typeof value,'string','Repository export paths must be strings');
  const result=value.replaceAll('\\','/');
  assert.ok(result&&result===path.posix.normalize(result)&&!path.posix.isAbsolute(result)&&result!=='.'&&!result.startsWith('../'),'Repository export paths must be normalized relative paths');
  return result;
};

export function validatePublicRepositorySpec(spec){
  assert.equal(spec?.format,2,'Unsupported public repository manifest format');
  assert.equal(spec?.kind,'MYCELIUM_PUBLIC_REPOSITORY_EXPORT','Invalid public repository manifest kind');
  const keys=['includeFiles','optionalIncludeFiles','includeDirectories','excludeDirectories'];
  const clean={...spec};
  for(const key of keys){
    assert.ok(Array.isArray(spec[key]),`${key} must be an array`);
    clean[key]=spec[key].map(normalized);
    assert.equal(new Set(clean[key]).size,clean[key].length,`${key} contains duplicates`);
  }
  assert.deepEqual(clean.excludeDirectories,['internal'],'Only the private internal boundary may be excluded');
  assert.deepEqual(clean.optionalIncludeFiles,['PROJECT-EXPORT.json'],'Only project-export provenance may be optional');
  for(const file of [...clean.includeFiles,...clean.includeDirectories])assert.ok(file!=='internal'&&!file.startsWith('internal/'),'Private internal paths cannot be included');
  assert.ok(!clean.includeFiles.includes('PROJECT-EXPORT.json'),'Project-export provenance must be optional');
  return clean;
}

export function selectPublicRepositoryFiles(candidates,specInput){
  const spec=validatePublicRepositorySpec(specInput),files=[...new Set(candidates.map(normalized))].sort();
  const inDirectory=file=>spec.includeDirectories.some(directory=>file.startsWith(directory+'/'));
  for(const file of spec.includeFiles)assert.ok(files.includes(file),`Missing explicitly included file: ${file}`);
  for(const directory of spec.includeDirectories)assert.ok(files.some(file=>file.startsWith(directory+'/')),`Empty or missing included directory: ${directory}`);
  const privateFile=file=>file.startsWith('internal/');
  const classified=files.filter(file=>spec.includeFiles.includes(file)||spec.optionalIncludeFiles.includes(file)||inDirectory(file)||privateFile(file));
  assert.deepEqual(classified,files,`Unclassified tracked files require an explicit export decision: ${files.filter(file=>!classified.includes(file)).join(', ')}`);
  const selected=files.filter(file=>!privateFile(file)&&(spec.includeFiles.includes(file)||spec.optionalIncludeFiles.includes(file)||inDirectory(file)));
  for(const file of selected){
    assert.ok(!FORBIDDEN_PATHS.some(rule=>rule.test(file))||file==='.env.example',`Forbidden public repository path: ${file}`);
  }
  return selected;
}

export function secretFindingsInText(text,file='input'){
  return SECRET_RULES.filter(([,rule])=>rule.test(text)).map(([rule])=>({file,rule}));
}

export async function inspectPublicRepositoryFiles(files,root=projectRoot){
  const hashes={},findings=[];
  for(const file of files){
    assert.ok(lstatSync(path.join(root,file)).isFile(),`Public repository export accepts regular files only: ${file}`);
    const content=await readFile(path.join(root,file));hashes[file]=sha256(content);
    if(!content.includes(0))findings.push(...secretFindingsInText(content.toString('utf8'),file));
  }
  assert.deepEqual(findings,[],'Secret-like material found in public repository export');
  assertRepositoryReferences(files,root);
  return hashes;
}

export async function inspectPublishedRepositoryCheckout(files,root=projectRoot){
  assert.ok(files.includes('PROJECT-EXPORT.json'),'Published checkout is missing PROJECT-EXPORT.json');
  const provenance=JSON.parse(await readFile(path.join(root,'PROJECT-EXPORT.json'),'utf8'));
  assert.equal(provenance?.format,1,'Unsupported project-export provenance format');
  assert.equal(provenance?.kind,'MYCELIUM_FULL_PROJECT_EXPORT','Invalid project-export provenance kind');
  assert.match(provenance?.source?.commit||'',/^[0-9a-f]{40}$/,'Invalid development source commit');
  assert.match(provenance?.source?.tree||'',/^[0-9a-f]{40}$/,'Invalid development source tree');
  assert.equal(provenance?.exportSpec,SPEC_PATH,'Project export names the wrong export policy');
  assert.deepEqual(provenance?.excludedDirectories,['internal'],'Project export must exclude only the private internal boundary');
  assert.ok(provenance?.files&&typeof provenance.files==='object'&&!Array.isArray(provenance.files),'Project export is missing its file inventory');

  const exportedHashes=new Map();
  for(const [rawFile,hash] of Object.entries(provenance.files)){
    const file=normalized(rawFile);
    assert.equal(file,rawFile,`Project export has a non-canonical file path: ${rawFile}`);
    assert.match(hash,/^[0-9a-f]{64}$/,`Project export file has an invalid hash: ${file}`);
    exportedHashes.set(file,hash);
  }
  const exportedFiles=[...exportedHashes.keys()].sort();
  assert.ok(!exportedFiles.includes('PROJECT-EXPORT.json'),'Project export cannot hash itself');
  const releaseIndexPath='verification/core/release-index.json';
  assert.ok(exportedFiles.includes(releaseIndexPath),'Project export is missing the source-verification release index');
  const releaseIndex=JSON.parse(await readFile(path.join(root,releaseIndexPath),'utf8'));
  assert.equal(releaseIndex?.format,1,'Unsupported source-verification release index');
  assert.equal(releaseIndex?.kind,'MYCELIUM_SOURCE_VERIFICATION_RELEASE_INDEX','Invalid source-verification release index');

  const capsuleHashes=new Map();
  for(const [digest,release] of Object.entries(releaseIndex.releases||{})){
    assert.match(digest,/^[0-9a-f]{64}$/,'Invalid indexed release digest');
    assert.equal(release?.capsule?.repository,'https://github.com/MagicForestLand/mycelium',`Release ${digest} names the wrong capsule repository`);
    assert.match(release?.capsule?.commit||'',/^[0-9a-f]{40}$/,`Release ${digest} has an invalid capsule commit`);
    const capsuleRoot=normalized(release?.capsule?.path||'');
    assert.equal(capsuleRoot,`verification/core/releases/${digest}`,`Release ${digest} has an invalid capsule path`);
    assert.ok(release?.capsule?.files&&typeof release.capsule.files==='object'&&!Array.isArray(release.capsule.files),`Release ${digest} is missing capsule files`);
    for(const [name,hash] of Object.entries(release.capsule.files)){
      assert.equal(name,path.posix.basename(name),`Release ${digest} has an invalid capsule filename`);
      assert.match(hash,/^[0-9a-f]{64}$/,`Release ${digest} capsule ${name} has an invalid hash`);
      const file=normalized(`${capsuleRoot}/${name}`);
      assert.ok(!capsuleHashes.has(file),`Duplicate indexed capsule file: ${file}`);
      capsuleHashes.set(file,hash);
    }
  }
  assert.ok(capsuleHashes.size>0,'Published checkout has no indexed source-verification artifacts');

  const expected=[...new Set([...exportedFiles,'PROJECT-EXPORT.json',...capsuleHashes.keys()])].sort();
  assert.deepEqual([...files].sort(),expected,'Published checkout must contain exactly the full-project export plus its indexed verification capsules');
  for(const [file,hash] of [...exportedHashes,...capsuleHashes]){
    const content=await readFile(path.join(root,file));
    assert.equal(sha256(content),hash,`Published checkout file differs from its recorded hash: ${file}`);
  }
  return {exportedFileCount:exportedFiles.length,capsuleFileCount:capsuleHashes.size,source:provenance.source};
}

async function loadSelection(){
  const spec=JSON.parse(await readFile(path.join(projectRoot,SPEC_PATH),'utf8'));
  const candidates=git('ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(file=>file&&existsSync(path.join(projectRoot,file)));
  const files=selectPublicRepositoryFiles(candidates,spec),hashes=await inspectPublicRepositoryFiles(files);
  return {spec:validatePublicRepositorySpec(spec),files,hashes};
}

export async function exportPublicRepository(destination){
  assertExternalOutput(destination);assert.ok(!existsSync(destination),'Public repository export destination must not already exist');
  assert.equal(git('status','--porcelain=v1','--untracked-files=all'),'','Public repository export requires a clean tracked and untracked source checkout');
  const {spec,files,hashes}=await loadSelection();
  await mkdir(destination,{mode:0o700});
  for(const file of files.filter(file=>file!=='PROJECT-EXPORT.json')){const target=path.join(destination,file);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(projectRoot,file),target);}
  const provenance={format:1,kind:'MYCELIUM_FULL_PROJECT_EXPORT',source:{commit:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}')},exportSpec:SPEC_PATH,
    excludedDirectories:spec.excludeDirectories,files:Object.fromEntries(Object.entries(hashes).filter(([file])=>file!=='PROJECT-EXPORT.json'))};
  await writeFile(path.join(destination,'PROJECT-EXPORT.json'),JSON.stringify(provenance,null,2)+'\n',{flag:'wx',mode:0o600});
  return {destination:path.resolve(destination),fileCount:files.length,source:provenance.source};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [destination]=process.argv.slice(2);
  if(destination==='--check'){
    const {files}=await loadSelection();
    if(files.includes('PROJECT-EXPORT.json')){
      const published=await inspectPublishedRepositoryCheckout(files);
      console.log(`PASS published repository: ${published.exportedFileCount} exported files and ${published.capsuleFileCount} indexed capsule files verified; private boundary and secret scan verified.`);
    }else console.log(`PASS public repository inventory: ${files.length} files selected; private boundary and secret scan verified.`);
  }else{
    assert.ok(destination,'Usage: node tooling/release/export-public-repository.mjs --check | /absolute/external/destination');
    const result=await exportPublicRepository(destination);console.log(`Public repository snapshot: ${result.destination}. ${result.fileCount} files. No git repository or remote created.`);
  }
}
