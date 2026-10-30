import {withCommitReveal} from '../lib/protected-test-client.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {Contract,ContractFactory,JsonRpcProvider,keccak256} from 'ethers';
import {compileContracts,artifactFor} from '../lib/compile-contracts.mjs';
import {deploymentPlan,resolveArguments,catalogFingerprint} from '../lib/deployment-plan.mjs';
import {editions} from '../../collection/source/art.js';
const provider=new JsonRpcProvider('http://127.0.0.1:8545',undefined,{cacheTimeout:-1});
provider.pollingInterval=100;
if(Number((await provider.getNetwork()).chainId)!==31337)throw Error('Local deploy requires chain 31337.');
const signer=await provider.getSigner(),owner=await signer.getAddress();
const config={chainId:31337,treasury:owner,initialOwner:owner,saleCap:1000,royaltyBps:500,royaltyReceiver:owner};
console.log('Compiling the full production art and contracts…');
const {compiled,compiler}=compileContracts({fixtures:false});
const {steps}=deploymentPlan(config),addresses={},transactions=[];
const runId=new Date().toISOString().replace(/[-:]/g,'').slice(0,15).toLowerCase()+'-'+randomBytes(3).toString('hex');
async function deploy(step){
  const artifact=artifactFor(compiled,step.file,step.name);
  const args=resolveArguments(step.args,addresses);
  const contract=await new ContractFactory(artifact.abi,artifact.bytecode,signer).deploy(...args);
  const receipt=await contract.deploymentTransaction().wait();
  const address=await contract.getAddress();addresses[step.name]=address;
  transactions.push({name:step.name,address,args,hash:receipt.hash,blockNumber:receipt.blockNumber});
  console.log(`${step.name}: ${address}`);
  return {contract:step.name==='MyceliumFriends'?withCommitReveal(contract,{request:({method,params=[]})=>provider.send(method,params)}):contract,receipt,address};
}
for(const step of steps.slice(0,-1))await deploy(step);
const deployments=[];
for(const scenario of ['public-zero','allowlist-free','spiral']){
  const {contract,receipt,address}=await deploy(steps.at(-1));
  const accounts=await provider.listAccounts();
  if(scenario!=='public-zero')await(await contract.setAllowlistAllocations(await Promise.all(accounts.map(a=>a.getAddress())),accounts.map(()=>5))).wait();
  await(await contract.startAllowlistSale()).wait();
  if(scenario==='spiral'){
    for(const edition of editions.slice(0,3))await(await contract.mint(...edition.genotype)).wait();
  }
  if(scenario!=='allowlist-free')await(await contract.openPublicSale()).wait();
  if(scenario==='spiral'){
    for(const edition of editions.slice(3,13))await(await contract.mint(...edition.genotype,{value:await contract.mintPrice(1)})).wait();
  }
  const block=await provider.getBlock(receipt.blockNumber);
  deployments.push({id:`local-${scenario}-${runId}`,label:`Local · ${scenario} · ${runId}`,scenario,mintProtocol:'commit-reveal-v1',saleLifecycle:'phased-v1',chainId:31337,
    networkName:'myFriends Local',address,rpcUrl:'http://127.0.0.1:8545',deploymentBlock:receipt.blockNumber,
    deploymentHash:block.hash,codeHash:keccak256(await provider.getCode(address)),catalogHash:catalogFingerprint().sha256});
}
const output=new URL(`../../.dev/deployments/${runId}/`,import.meta.url);await mkdir(output,{recursive:true});
await writeFile(new URL('manifest.json',output),JSON.stringify({runId,compiler,config,addresses,transactions,deployments},null,2)+'\n');
const runtimePath=new URL('../../apps/web/chain-config.json',import.meta.url);
let previous={};try{previous=JSON.parse(await readFile(runtimePath,'utf8'));}catch{}
const runtime={version:1,projectId:process.env.REOWN_PROJECT_ID||previous.projectId||'',activeDeployment:deployments[2].id,
  deployments:[...deployments,...(previous.deployments||[]).filter(d=>d.chainId!==31337)]};
await writeFile(runtimePath,JSON.stringify(runtime,null,2)+'\n');
console.log(`Ready: ${runId}. Three independent collections; shared immutable art.\nOpen http://127.0.0.1:4173. Transient manifests are preserved in .dev/deployments/.`);
provider.destroy();
