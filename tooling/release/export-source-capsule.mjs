import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectRoot} from '../lib/compile-contracts.mjs';
import {assertExternalOutput} from '../lib/release-paths.mjs';
import {verifyProductionInputs} from '../lib/release-binding.mjs';
import {sourceVerificationBundle} from '../verification/source-verification.mjs';
import {verifyArchitectureEquivalenceEvidence} from '../verification/architecture-equivalence.mjs';
import {secretFindingsInText} from './export-public-repository.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const MIT_LICENSE=`The MIT License (MIT)

Copyright (c) 2016-2025 Zeppelin Group Ltd

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

function normalized(file){
  assert.equal(file,path.posix.normalize(file),`Capsule path must be normalized: ${file}`);
  assert.ok(file&&!path.posix.isAbsolute(file)&&!file.startsWith('../'),`Capsule path escapes its root: ${file}`);
  return file;
}

export async function sourceCapsuleFiles(manifest,bundle,equivalence,{root=projectRoot}={}){
  assert.match(manifest.digest,/^[0-9a-f]{64}$/,'Invalid release digest');
  assert.equal(bundle.summary.releaseDigest,manifest.digest,'Verification bundle release mismatch');
  assert.equal(equivalence?.format,1,'Migration equivalence evidence format 1 required');
  assert.equal(equivalence?.kind,'MYCELIUM_ARCHITECTURE_EQUIVALENCE','Migration equivalence evidence required');
  assert.equal(equivalence?.candidateCommit,manifest.source.commit,'Equivalence evidence is for another candidate');
  assert.equal(equivalence?.allEquivalent,true,'Executable equivalence must pass before capsule export');
  const openzeppelin=JSON.parse(await readFile(path.join(root,'node_modules/@openzeppelin/contracts/package.json'),'utf8'));
  assert.equal(openzeppelin.version,'5.4.0','Review and update the pinned OpenZeppelin notice before exporting a new dependency version');
  assert.equal(openzeppelin.license,'MIT','Unexpected OpenZeppelin license metadata');

  const releaseRoot=`verification/core/releases/${manifest.digest}`;
  const files=new Map();
  for(const [file,{content}] of Object.entries(bundle.standardInput.sources))if(file.startsWith('contracts/core/'))files.set(normalized(file),content);
  files.set('contracts/LICENSE',await readFile(path.join(root,'contracts/LICENSE')));
  files.set('verification/README.md',await readFile(path.join(root,'verification/README.md')));
  files.set('verification/storage-layout.mjs',await readFile(path.join(root,'verification/storage-layout.mjs')));
  files.set('verification/verify-standard-json.mjs',await readFile(path.join(root,'verification/verify-standard-json.mjs')));
  files.set(`${releaseRoot}/standard-json-input.json`,json(bundle.standardInput));
  files.set(`${releaseRoot}/THIRD-PARTY-NOTICES.md`,`# Third-party notices\n\nThe exact Standard JSON input embeds OpenZeppelin Contracts ${openzeppelin.version} source files under \`@openzeppelin/contracts/\`. Those files are licensed under the MIT License.\n\nUpstream: ${openzeppelin.repository.url}\n\n## OpenZeppelin Contracts — MIT License\n\n\`\`\`text\n${MIT_LICENSE}\`\`\`\n`);

  const hashedFiles=Object.fromEntries([...files].sort(([a],[b])=>a.localeCompare(b)).map(([file,content])=>[file,sha256(content)]));
  const snapshot={format:1,kind:'MYCELIUM_RELEASE_SOURCE_SNAPSHOT',status:'PREDEPLOYMENT_SOURCE_CAPSULE',releaseDigest:manifest.digest,
    developmentSource:{commit:manifest.source.commit,tree:manifest.source.tree},identityPolicy:'CAPSULE_GIT_IDENTITY_IS_SEPARATE_AND_NOT_PREDICTED',
    exportPolicy:{profile:'minimal-source-verification-capsule',excludedBoundary:'internal/'},standardInputSha256:bundle.summary.standardInputSha256,
    files:hashedFiles,derivedFiles:[`${releaseRoot}/SOURCE-SNAPSHOT.json`,`${releaseRoot}/verification-summary.json`]};
  const snapshotText=json(snapshot);files.set(`${releaseRoot}/SOURCE-SNAPSHOT.json`,snapshotText);
  const summary={...bundle.summary,format:2,status:'PREDEPLOYMENT_SOURCE_CAPSULE',sourceSnapshotSha256:sha256(snapshotText),
    metadataFreeEquivalence:equivalence};
  files.set(`${releaseRoot}/verification-summary.json`,json(summary));
  return files;
}

export function inspectSourceCapsule(files,digest){
  const names=[...files.keys()].sort(),releaseRoot=`verification/core/releases/${digest}/`;
  assert.ok(names.every(file=>file.startsWith('contracts/core/')||file==='contracts/LICENSE'||file==='verification/README.md'||file==='verification/storage-layout.mjs'||file==='verification/verify-standard-json.mjs'||file.startsWith(releaseRoot)),'Capsule contains an unclassified path');
  assert.ok(names.some(file=>file.startsWith('contracts/core/')),'Capsule has no core sources');
  for(const required of ['SOURCE-SNAPSHOT.json','standard-json-input.json','verification-summary.json','THIRD-PARTY-NOTICES.md'])assert.ok(files.has(releaseRoot+required),`Capsule is missing ${required}`);
  const forbidden=names.filter(file=>/(^|\/)(?:internal|\.dev|node_modules|output)(?:\/|$)|(^|\/)\.env(?:\.|$)/.test(file));
  assert.deepEqual(forbidden,[],'Capsule contains private or transient paths');
  const findings=names.flatMap(file=>secretFindingsInText(Buffer.from(files.get(file)).toString('utf8'),file));
  assert.deepEqual(findings,[],'Secret-like material found in source capsule');
  return {files:names,hashes:Object.fromEntries(names.map(file=>[file,sha256(files.get(file))]))};
}

export async function exportSourceCapsule(manifestPath,expectedDigest,equivalencePath,destination){
  assertExternalOutput(destination);assert.ok(!existsSync(destination),'Source capsule destination must not already exist');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),equivalence=JSON.parse(await readFile(equivalencePath,'utf8'));
  await verifyProductionInputs(manifest,expectedDigest);
  await verifyArchitectureEquivalenceEvidence(equivalence,{expectedCandidate:manifest.source.commit});
  const files=await sourceCapsuleFiles(manifest,sourceVerificationBundle(manifest),equivalence),inventory=inspectSourceCapsule(files,manifest.digest);
  await mkdir(destination,{recursive:false,mode:0o700});
  for(const [file,content] of files){const target=path.join(destination,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,content,{flag:'wx',mode:0o600});}
  return {destination:path.resolve(destination),releaseDigest:manifest.digest,fileCount:inventory.files.length};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [manifestPath,expectedDigest,equivalencePath,destination]=process.argv.slice(2);
  assert.ok(manifestPath&&expectedDigest&&equivalencePath&&destination,'Usage: node tooling/release/export-source-capsule.mjs manifest.json APPROVED_SHA256 architecture-equivalence.json /absolute/external/capsule');
  const result=await exportSourceCapsule(manifestPath,expectedDigest,equivalencePath,destination);
  console.log(`Source capsule: ${result.destination}. Release ${result.releaseDigest}; ${result.fileCount} files. No Git repository, remote or network request created.`);
}
