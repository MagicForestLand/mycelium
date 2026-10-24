import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {semanticStorageLayout,STORAGE_LAYOUT_HASH_POLICY} from './storage-layout.mjs';

const [outputPath,summaryPath]=process.argv.slice(2);
assert.ok(outputPath&&summaryPath,'Usage: node verification/verify-standard-json.mjs compiler-output.json verification-summary.json');
const [output,summary]=await Promise.all([outputPath,summaryPath].map(file=>readFile(file,'utf8').then(JSON.parse)));
const errors=(output.errors||[]).filter(item=>item.severity==='error');
assert.deepEqual(errors,[],'Solidity compilation failed');
assert.equal(summary.storageLayoutHashPolicy,STORAGE_LAYOUT_HASH_POLICY,'Unsupported storage-layout hash policy');
const sha256=value=>createHash('sha256').update(value).digest('hex');
for(const expected of summary.contracts){
  const artifact=output.contracts?.[expected.source]?.[expected.name];
  assert.ok(artifact,`Missing compiler artifact ${expected.compilerContract}`);
  assert.equal(sha256(JSON.stringify(artifact.abi)),expected.abiSha256,`${expected.name}: ABI differs`);
  assert.equal(sha256(JSON.stringify(semanticStorageLayout(artifact.storageLayout))),expected.storageLayoutSha256,`${expected.name}: storage layout differs`);
  assert.equal(sha256(Buffer.from(artifact.evm.bytecode.object,'hex')),expected.creationBytecodeSha256,`${expected.name}: creation bytecode differs`);
  assert.equal(sha256(Buffer.from(artifact.evm.deployedBytecode.object,'hex')),expected.runtimeTemplateSha256,`${expected.name}: runtime template differs`);
}
console.log(`PASS source capsule compiler output: ${summary.contracts.length} deployment artifacts match release ${summary.releaseDigest}.`);
