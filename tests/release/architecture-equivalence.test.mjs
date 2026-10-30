import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {ARCHITECTURE_EQUIVALENCE_KIND,assertArchitectureEquivalenceEvidence} from '../../tooling/verification/architecture-equivalence.mjs';

const sha256=value=>createHash('sha256').update(value).digest('hex');
const canonicalJSON=value=>{
  if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJSON(value[key])).join(',')+'}';
  return JSON.stringify(value);
};
const gate=()=>({equivalent:true});

function fixture(){
  const payload={format:1,kind:ARCHITECTURE_EQUIVALENCE_KIND,baselineCommit:'a'.repeat(40),candidateCommit:'b'.repeat(40),
    comparison:'STRUCTURAL_PATH_MIGRATION_METADATA_FREE_EXECUTABLE_EQUIVALENCE',pathMapping:{baseline:'contracts/',candidate:'contracts/core/'},
    toolchain:{},sourcePairCount:16,gates:{productionSoliditySources:gate(),generatedSoliditySources:gate(),compilerArtifacts:gate(),
      deploymentSemantics:gate(),canonicalArtwork:gate(),artworkReleaseLock:gate()},allEquivalent:true};
  return {...payload,evidenceSha256:sha256(canonicalJSON(payload))};
}

test('architecture evidence requires every deterministic gate and an intact digest',()=>{
  const evidence=fixture();
  assert.equal(assertArchitectureEquivalenceEvidence(evidence,{expectedCandidate:evidence.candidateCommit}),evidence);
  const assertedOnly={format:1,kind:ARCHITECTURE_EQUIVALENCE_KIND,baselineCommit:'a'.repeat(40),candidateCommit:'b'.repeat(40),allEquivalent:true};
  assert.throws(()=>assertArchitectureEquivalenceEvidence(assertedOnly),/incomplete gates/);
  const altered=structuredClone(evidence);altered.gates.compilerArtifacts.count=1;
  assert.throws(()=>assertArchitectureEquivalenceEvidence(altered),/digest differs/);
  const failed=structuredClone(evidence);failed.gates.canonicalArtwork.equivalent=false;
  assert.throws(()=>assertArchitectureEquivalenceEvidence(failed),/did not pass/);
});

test('source capsule exporter regenerates architecture evidence before writing files',()=>{
  const source=readFileSync(new URL('../../tooling/release/export-source-capsule.mjs',import.meta.url),'utf8');
  assert.match(source,/await verifyArchitectureEquivalenceEvidence\(equivalence,\{expectedCandidate:manifest\.source\.commit\}\)/);
});
