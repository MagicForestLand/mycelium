import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,realpath,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {JsonRpcProvider,keccak256,toQuantity} from 'ethers';
import {projectRoot} from '../lib/compile-contracts.mjs';
import {verifyProductionInputs} from '../lib/release-binding.mjs';
import {assertExternalOutput} from '../lib/release-paths.mjs';
import {writePrivateJSON} from '../release/mainnet-release.mjs';
import {loadBoundSafePolicy} from './verify-safe-policy.mjs';
import {ANVIL_FORK_PIN,rehearseMainnetFork} from './mainnet-fork.mjs';

export const ANVIL_COMMIT=ANVIL_FORK_PIN.commit;
const EMPTY_CODE_HASH=keccak256('0x'),execFileAsync=promisify(execFile),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function sha256(value){return createHash('sha256').update(value).digest('hex');}
function normalizedHash(value){assert.match(value,/^0x[0-9a-f]{64}$/i,'Pinned block hash required');return value.toLowerCase();}

export function publicRpcIdentity(value){
  const url=new URL(value);
  assert.equal(url.protocol,'https:','Fork provenance providers must use HTTPS');
  assert.equal(url.username,'','Fork provenance provider URL must not contain username credentials');
  assert.equal(url.password,'','Fork provenance provider URL must not contain password credentials');
  return {hostname:url.hostname.toLowerCase(),port:url.port||'443'};
}

export function anvilLaunchArguments({upstreamRpc,forkBlock,port}){
  assert.ok(Number.isSafeInteger(forkBlock)&&forkBlock>0,'Positive fork block required');
  assert.ok(Number.isSafeInteger(port)&&port>=1024&&port<=65535,'Explicit unprivileged loopback port required');
  publicRpcIdentity(upstreamRpc);
  return ['--fork-url',upstreamRpc,'--fork-block-number',String(forkBlock),'--hardfork',ANVIL_FORK_PIN.hardfork,
    '--chain-id','1','--enable-tx-gas-limit','--no-storage-caching','--host','127.0.0.1','--port',String(port),'--silent'];
}

export function sanitizedLaunchTranscript(binaryPath,args){
  const sanitized=[...args],index=sanitized.indexOf('--fork-url');
  assert.ok(index>=0&&index+1<sanitized.length,'Anvil launch must contain the upstream fork URL');
  sanitized[index+1]='<REDACTED_UPSTREAM_MAINNET_RPC>';
  return {executable:binaryPath,arguments:sanitized,command:[binaryPath,...sanitized].map(value=>JSON.stringify(value)).join(' ')};
}

export function assertPinnedAnvilVersion(output){
  assert.match(output,new RegExp(`^anvil Version: ${ANVIL_FORK_PIN.version.replaceAll('.','\\.')}\\s*$`,'m'),'Unexpected Anvil version');
  assert.match(output,new RegExp(`^Commit SHA: ${ANVIL_COMMIT}\\s*$`,'mi'),'Unexpected Anvil commit');
}

export async function inspectAnvilBinary({binaryPath,expectedSha256,run=execFileAsync}){
  assert.match(expectedSha256,/^[0-9a-f]{64}$/,'Explicit lowercase approved Anvil SHA-256 required');
  const resolved=await realpath(binaryPath),details=await stat(resolved);
  assert.ok(details.isFile()&&(details.mode&0o111)!==0,'Anvil path must be an executable regular file');
  const bytes=await readFile(resolved),actualSha256=sha256(bytes);
  assert.equal(actualSha256,expectedSha256,'Anvil binary SHA-256 differs from the approved digest');
  const result=await run(resolved,['--version'],{encoding:'utf8',maxBuffer:1024*1024}),output=String(result.stdout??result).trim();
  assertPinnedAnvilVersion(output);
  return {path:resolved,sha256:actualSha256,expectedSha256,version:ANVIL_FORK_PIN.version,commit:ANVIL_COMMIT,versionOutput:output};
}

async function rpcBlock(provider,tag){return provider.send('eth_getBlockByNumber',[tag,false]);}

export async function verifyFinalizedBlockConsensus({rpcUrls,forkBlock,forkHash,providerFactory=url=>new JsonRpcProvider(url,1,{cacheTimeout:-1})}){
  assert.equal(rpcUrls.length,2,'Exactly two independent fork provenance providers required');
  const identities=rpcUrls.map(publicRpcIdentity);
  assert.notEqual(identities[0].hostname,identities[1].hostname,'Fork provenance providers must use different hostnames');
  const expectedHash=normalizedHash(forkHash),providers=[];
  for(let index=0;index<rpcUrls.length;index++){
    const provider=providerFactory(rpcUrls[index]);
    try{
      assert.equal(BigInt(await provider.send('eth_chainId',[])),1n,'Fork provenance provider is not Ethereum mainnet');
      const pinned=await rpcBlock(provider,toQuantity(forkBlock)),finalized=await rpcBlock(provider,'finalized');
      assert.equal(Number(BigInt(pinned?.number)),forkBlock,'Fork provenance provider returned the wrong pinned block number');
      assert.equal(pinned?.hash?.toLowerCase(),expectedHash,'Fork provenance provider returned a different pinned block hash');
      assert.ok(finalized?.hash&&Number(BigInt(finalized.number))>=forkBlock,'Pinned block is not finalized at a provenance provider');
      providers.push({...identities[index],chainId:'1',pinnedBlockHash:expectedHash,
        finalizedBlockNumber:Number(BigInt(finalized.number)),finalizedBlockHash:normalizedHash(finalized.hash)});
    }finally{provider.destroy?.();}
  }
  return {status:'TWO_PROVIDER_FINALIZED_BLOCK_CONSENSUS',blockNumber:forkBlock,blockHash:expectedHash,providers};
}

async function waitForAnvil(provider,child){
  let lastError;
  for(let attempt=0;attempt<120;attempt++){
    if(child.exitCode!==null)throw Error(`Anvil exited before becoming ready with code ${child.exitCode}`);
    try{return await provider.send('web3_clientVersion',[]);}catch(error){lastError=error;await delay(250);}
  }
  throw Error(`Anvil did not become ready: ${lastError?.message||lastError}`);
}

export async function stopChild(child,{wait=delay,gracePeriodMs=5000}={}){
  if(child.exitCode!==null||child.signalCode!==null)return;
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');
  await Promise.race([exited,wait(gracePeriodMs)]);
  if(child.exitCode===null&&child.signalCode===null){const killed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await killed;}
}

export async function runPinnedMainnetFork({manifestPath,expectedDigest,forkBlock,forkHash,reportPath,safePolicyPath,
  anvilPath,expectedAnvilSha256,port,upstreamRpc,secondaryRpc,spawnProcess=spawn,providerFactory=url=>new JsonRpcProvider(url,1,{cacheTimeout:-1})}){
  assertExternalOutput(reportPath);
  const manifest=JSON.parse(await readFile(manifestPath,'utf8')),
    safePolicy=manifest.config.roleCodeHashes.initialOwner!==EMPTY_CODE_HASH?await loadBoundSafePolicy(safePolicyPath):undefined,
    compilation=await verifyProductionInputs(manifest,expectedDigest),
    binary=await inspectAnvilBinary({binaryPath:anvilPath,expectedSha256:expectedAnvilSha256}),
    blockConsensus=await verifyFinalizedBlockConsensus({rpcUrls:[upstreamRpc,secondaryRpc],forkBlock,forkHash,providerFactory}),
    args=anvilLaunchArguments({upstreamRpc,forkBlock,port}),transcript=sanitizedLaunchTranscript(binary.path,args),
    executionEnvironment={format:1,kind:'MYCELIUM_PINNED_ANVIL_EXECUTION',binary,
      launch:{manager:'REPOSITORY_MANAGED_CHILD_PROCESS',...transcript,chainId:1,host:'127.0.0.1',port,
        hardfork:ANVIL_FORK_PIN.hardfork,transactionGasCap:ANVIL_FORK_PIN.transactionGasCap,noStorageCaching:true},blockConsensus};
  const childEnvironment={...process.env};delete childEnvironment.UPSTREAM_MAINNET_RPC;delete childEnvironment.SECONDARY_MAINNET_RPC;
  const child=spawnProcess(binary.path,args,{cwd:projectRoot,env:childEnvironment,stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr?.on('data',chunk=>{if(stderr.length<65536)stderr+=String(chunk).slice(0,65536-stderr.length);});
  const provider=providerFactory(`http://127.0.0.1:${port}`);
  try{
    await waitForAnvil(provider,child);
    const report=await rehearseMainnetFork({provider,manifest,expectedDigest,compiled:compilation.compiled,forkBlock,forkHash,safePolicy,executionEnvironment});
    await writePrivateJSON(reportPath,report);
    return report;
  }catch(error){
    if(stderr.trim())error.message+=`\nAnvil stderr: ${stderr.trim().replaceAll(upstreamRpc,'<REDACTED_UPSTREAM_MAINNET_RPC>').slice(0,2000)}`;
    throw error;
  }finally{provider.destroy?.();await stopChild(child);}
}

function parse(argv){
  const [manifestPath,...rest]=argv,take=flag=>{const index=rest.indexOf(flag);return index<0?undefined:rest[index+1];};
  return {manifestPath,expectedDigest:take('--expected-release'),forkBlock:Number(take('--fork-block')),forkHash:take('--fork-hash'),
    reportPath:take('--report'),safePolicyPath:take('--safe-policy'),anvilPath:take('--anvil'),expectedAnvilSha256:take('--expected-anvil-sha256'),port:Number(take('--port')||19546)};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=parse(process.argv.slice(2)),upstreamRpc=process.env.UPSTREAM_MAINNET_RPC,secondaryRpc=process.env.SECONDARY_MAINNET_RPC;
  assert.ok(args.manifestPath&&args.expectedDigest&&args.forkBlock&&args.forkHash&&args.reportPath&&args.anvilPath&&args.expectedAnvilSha256,
    'Usage: UPSTREAM_MAINNET_RPC=https://... SECONDARY_MAINNET_RPC=https://... node tooling/verification/run-mainnet-fork.mjs manifest.json --expected-release SHA256 --fork-block N --fork-hash 0xHASH --anvil /pinned/anvil --expected-anvil-sha256 SHA256 --port 19546 --report /external/fork-report.json');
  assert.ok(upstreamRpc&&secondaryRpc,'Two explicit independent mainnet RPC URLs required');
  const report=await runPinnedMainnetFork({...args,upstreamRpc,secondaryRpc});
  console.log(`Fork rehearsal complete at ${report.fork.blockNumber}/${report.fork.blockHash}. No public transaction sent.`);
}
