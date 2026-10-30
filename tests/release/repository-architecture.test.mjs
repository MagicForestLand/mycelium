import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {productionSources,projectRoot} from '../../tooling/lib/compile-contracts.mjs';

const read=file=>readFileSync(new URL('../../'+file,import.meta.url),'utf8');

test('production source and application scopes use only the canonical architecture',()=>{
  assert.ok(productionSources.every(file=>file.startsWith('contracts/core/')));
  for(const retired of ['frontend','contracts/generated','render.yaml','deployments/mainnet.json','docs/core','docs/project','docs/collection/COLLECTION-COPY.md'])assert.equal(existsSync(new URL('../../'+retired,import.meta.url)),false,`Retired path remains: ${retired}`);
  assert.ok(existsSync(new URL('../../apps/web/index.html',import.meta.url)));
  assert.ok(existsSync(new URL('../../infra/render/render.yaml',import.meta.url)));
  assert.ok(existsSync(new URL('../../verification/README.md',import.meta.url)));
  for(const current of ['docs/ARCHITECTURE.md','docs/contracts/core/README.md','docs/repository/README.md','docs/collection/COLLECTION-CONTENT.md'])assert.ok(existsSync(new URL('../../'+current,import.meta.url)),`Missing canonical documentation path: ${current}`);
});

test('tracked top-level directories stay within the reviewed architecture',()=>{
  const spec=JSON.parse(read('tooling/config/public-repository.json'));
  const allowed=new Set([...spec.includeDirectories,'internal']);
  const tracked=spawnSync('git',['ls-files','-z'],{cwd:projectRoot,encoding:'utf8'});
  assert.equal(tracked.status,0,tracked.stderr||'Unable to inventory tracked repository paths');
  const roots=[...new Set(tracked.stdout.split('\0').filter(file=>file.includes('/')).map(file=>file.split('/')[0]))].sort();
  const unexpected=roots.filter(directory=>!allowed.has(directory));
  assert.deepEqual(unexpected,[],`Unexpected tracked top-level directories: ${unexpected.join(', ')}`);
});

test('full-project export and minimal source capsule remain explicit separate profiles',()=>{
  const spec=JSON.parse(read('tooling/config/public-repository.json'));
  for(const directory of ['apps','contracts','infra','verification'])assert.ok(spec.includeDirectories.includes(directory));
  assert.deepEqual(spec.optionalIncludeFiles,['PROJECT-EXPORT.json']);
  const capsule=read('tooling/release/export-source-capsule.mjs');
  assert.match(capsule,/minimal-source-verification-capsule/);
  assert.match(capsule,/verification\/core\/releases/);
  assert.doesNotMatch(capsule,/CAPSULE_GIT_IDENTITY_IS_SAME/);
  const runbook=read('docs/repository/release/PUBLIC-REPOSITORY-EXPORT.md');
  assert.match(runbook,/canonical destination already exists[\s\S]*MagicForestLand\/mycelium/i);
  assert.match(runbook,/preserv(?:e|es)[\s\S]*capsule/i);
  assert.match(runbook,/mycelium-dev[\s\S]*complete GitHub CI run must pass/i);
  assert.match(runbook,/separate,?[\s\S]*explicit approval[\s\S]*public-repository commit and push/i);
  assert.match(runbook,/annotated release tag[\s\S]*PROJECT-EXPORT\.json/i);
  assert.doesNotMatch(runbook,/initialize a new Git repository/i);
});

test('production defaults target scoped deployment and web configuration paths',()=>{
  assert.match(read('tooling/build/export-site.mjs'),/deployments\/core\/ethereum\/mainnet\.json/);
  assert.match(read('tooling/build/export-site.mjs'),/apps\/web\/config\/mainnet-site\.json/);
  assert.match(read('infra/render/render.yaml'),/deployments\/core\/ethereum\/mainnet\.json apps\/web\/config\/mainnet-site\.json/);
  assert.equal(projectRoot,new URL('../../',import.meta.url).pathname);
  const ignored=spawnSync('git',['check-ignore','--no-index','deployments/core/ethereum/mainnet.json'],{cwd:projectRoot,encoding:'utf8'});
  assert.equal(ignored.status,1,'Canonical nested deployment records must remain trackable');
});
