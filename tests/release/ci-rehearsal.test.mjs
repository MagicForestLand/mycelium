import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {keccak256} from 'ethers';
import {CI_REHEARSAL_KIND,syntheticCiConfig,syntheticSiteInputs} from '../../tooling/testing/prepare-ci-rehearsal.mjs';
import {deploymentPlan} from '../../tooling/lib/deployment-plan.mjs';

test('release CI rehearsal has fixed synthetic roles and complete bounded gas policy',()=>{
  const config=syntheticCiConfig(),steps=deploymentPlan(config).steps;
  assert.equal(CI_REHEARSAL_KIND,'SYNTHETIC_CI_REHEARSAL_NEVER_BROADCAST');
  assert.equal(config.chainId,1);assert.equal(config.kind,'PRODUCTION');assert.equal(config.nonce,0);assert.equal(config.saleCap,1000);
  assert.equal(new Set([config.deployer,config.initialOwner,config.treasury]).size,3);
  assert.deepEqual(Object.keys(config.gasLimits).sort(),steps.map(step=>step.name).sort());
  assert.ok(Object.values(config.gasLimits).every(value=>BigInt(value)<=1n<<24n));
  assert.ok(Object.values(config.roleCodeHashes).every(value=>value===keccak256('0x')));
});

test('release CI site inputs are visibly synthetic but exercise production export validation',()=>{
  const manifest={digest:'a'.repeat(64),source:{commit:'b'.repeat(40)},catalog:{sha256:'c'.repeat(64)},
    mintProtection:{protocol:'commit-reveal-v1',saleLifecycle:'phased-v1'},steps:[{name:'MyceliumFriends',address:'0x7100000000000000000000000000000000000010',runtimeHash:'0x'+'dd'.repeat(32)}]};
  const {deployment,site}=syntheticSiteInputs(manifest);
  assert.equal(deployment.network,'mainnet');assert.equal(deployment.releaseDigest,manifest.digest);
  assert.match(site.deployment.id,/synthetic/);assert.match(site.walletMetadata.description,/never a deployment record/i);
});

test('release rehearsal workflow is manual, read-only, checksum-pinned and loopback-only',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/release-rehearsal.yml',import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/\n\s+(?:push|pull_request):/);
  assert.match(workflow,/permissions:\n\s+contents: read/);assert.match(workflow,/environment: release-rehearsal/);
  for(const action of workflow.matchAll(/uses:\s+([^\s#]+)/g))assert.match(action[1],/^[\w-]+\/[\w-]+@[0-9a-f]{40}$/);
  assert.match(workflow,/cf7e688ed0c4c48adffca788b496076e31060b67ac5afe1e43dbb5499c20c88b/);
  assert.match(workflow,/SECONDARY_MAINNET_FORK_RPC_URL/);assert.match(workflow,/--expected-anvil-sha256 "\$anvil_sha"/);
  assert.doesNotMatch(workflow,/RPC_URL=http:\/\/127\.0\.0\.1:19546|anvil_pid=/);
  assert.doesNotMatch(workflow,/PRIVATE_KEY|MNEMONIC|release:mainnet|release:broadcast/);
});
