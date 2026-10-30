import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {standardCompilerInput} from '../lib/compile-contracts.mjs';
import {assertExternalOutput} from '../lib/release-paths.mjs';
import {verifyProductionInputs} from '../lib/release-binding.mjs';
import {semanticStorageLayout,STORAGE_LAYOUT_HASH_POLICY} from '../../verification/storage-layout.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');

export function sourceVerificationBundle(manifest){
  const standardInput=standardCompilerInput({fixtures:false});
  const sourceHashes=Object.fromEntries(Object.entries(standardInput.sources).sort(([a],[b])=>a.localeCompare(b)).map(([name,{content}])=>[name,sha256(content)]));
  assert.deepEqual(sourceHashes,manifest.sourceHashes,'Standard JSON sources differ from the approved release');
  const contracts=manifest.steps.map(step=>{
    const creation=step.artifact.bytecode.toLowerCase(),initcode=step.initcode.toLowerCase();
    assert.ok(initcode.startsWith(creation),`${step.name}: initcode does not begin with approved creation bytecode`);
    return {name:step.name,source:step.file,address:step.address,compilerContract:`${step.file}:${step.name}`,
      abiSha256:sha256(JSON.stringify(step.artifact.abi)),storageLayoutSha256:sha256(JSON.stringify(semanticStorageLayout(step.artifact.storageLayout))),
      creationBytecodeSha256:sha256(Buffer.from(step.artifact.bytecode.slice(2),'hex')),
      runtimeTemplateSha256:sha256(Buffer.from(step.artifact.deployedBytecode.slice(2),'hex')),
      constructorArguments:'0x'+initcode.slice(creation.length),creationCodeHash:step.creationCodeHash,initcodeHash:step.initcodeHash,runtimeHash:step.runtimeHash};
  });
  return {standardInput,summary:{format:1,kind:'MYCELIUM_SOURCE_VERIFICATION_BUNDLE',releaseDigest:manifest.digest,compiler:manifest.compiler,
    storageLayoutHashPolicy:STORAGE_LAYOUT_HASH_POLICY,
    compilerSettings:manifest.compilerSettings,standardInputSha256:sha256(JSON.stringify(standardInput)),sourceHashes,contracts}};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [manifestPath,expectedDigest,outputDir]=process.argv.slice(2);
  assert.ok(manifestPath&&expectedDigest&&outputDir,'Usage: node tooling/verification/source-verification.mjs manifest.json APPROVED_SHA256 /absolute/external/verification-dir');
  assertExternalOutput(outputDir);
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));await verifyProductionInputs(manifest,expectedDigest);
  const bundle=sourceVerificationBundle(manifest);await mkdir(outputDir,{recursive:true});
  await writeFile(path.join(outputDir,'standard-json-input.json'),JSON.stringify(bundle.standardInput,null,2)+'\n');
  await writeFile(path.join(outputDir,'verification-summary.json'),JSON.stringify(bundle.summary,null,2)+'\n');
  console.log(`Prepared source verification for ${bundle.summary.contracts.length} deployment steps. No network request sent.`);
}
