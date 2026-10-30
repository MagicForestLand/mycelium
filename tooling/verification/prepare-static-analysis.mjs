import assert from 'node:assert/strict';
import {chmod,mkdir,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {standardCompilerInput} from '../lib/compile-contracts.mjs';
import {assertExternalOutput} from '../lib/release-paths.mjs';

export function staticAnalysisInput(){
  const input=structuredClone(standardCompilerInput({fixtures:false}));
  const outputs=input.settings.outputSelection['*']['*'];
  for(const field of ['evm.bytecode.sourceMap','evm.deployedBytecode.sourceMap'])if(!outputs.includes(field))outputs.push(field);
  return input;
}

export async function writeStaticAnalysisInput(target){
  assertExternalOutput(target);
  const resolved=path.resolve(target),temporary=`${resolved}.${process.pid}.tmp`;
  await mkdir(path.dirname(resolved),{recursive:true});
  await writeFile(temporary,JSON.stringify(staticAnalysisInput())+'\n',{mode:0o600});
  await rename(temporary,resolved);await chmod(resolved,0o600);
  return resolved;
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const target=process.argv[2];
  assert.ok(target,'Usage: node tooling/verification/prepare-static-analysis.mjs /external/standard-json-input.json');
  const resolved=await writeStaticAnalysisInput(target);
  console.log(`Wrote production-only Standard JSON input to ${resolved}`);
}
