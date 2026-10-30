import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider} from 'ethers';
import {artifactFor} from '../lib/compile-contracts.mjs';
import {verifyProductionInputs} from '../lib/release-binding.mjs';
import {deploymentAddresses} from './verify-release.mjs';
import {verifyLiveDeployment} from '../lib/verify-deployment.mjs';

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const [manifestPath,evidencePath,expectedDigest]=process.argv.slice(2);
  assert.ok(manifestPath&&evidencePath&&expectedDigest&&process.env.RPC_URL,
    'Usage: RPC_URL=... node tooling/verification/live-health.mjs manifest.json mainnet-broadcast.json EXPECTED_DIGEST');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),evidence=JSON.parse(await readFile(evidencePath,'utf8'));
  deploymentAddresses(evidence,manifest);
  const compilation=await verifyProductionInputs(manifest,expectedDigest);
  const artifact=artifactFor(compilation.compiled,'contracts/core/MyceliumFriends.sol','MyceliumFriends');
  const provider=new JsonRpcProvider(process.env.RPC_URL,1,{cacheTimeout:-1});
  try{console.log(JSON.stringify(await verifyLiveDeployment({provider,manifest,artifact}),null,2));}
  finally{provider.destroy();}
}
