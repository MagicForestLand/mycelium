import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Contract,MaxUint256,ZeroAddress,getAddress,keccak256,toBeHex,toQuantity} from 'ethers';
import {broadcastPreparedManifest,validateMainnetBroadcastManifest} from '../lib/broadcast-release.mjs';
import {artifactFor} from '../lib/compile-contracts.mjs';
import {deploymentPlan} from '../lib/deployment-plan.mjs';
import {inspectProductionNetwork} from './release-preflight.mjs';
import {sourceIdentity} from '../lib/release-binding.mjs';
import {verifyDeployment,verifyLiveDeployment} from '../lib/verify-deployment.mjs';
import {traitsForGenotypeIndex} from '../../collection/source/token-id.js';
import {assertSafeRoleBinding,inspectSafePolicy} from './verify-safe-policy.mjs';

export const ANVIL_FORK_PIN=Object.freeze({version:'1.7.1',commit:'4072e48705af9d93e3c0f6e29e93b5e9a40caed8',hardfork:'osaka',transactionGasCap:'16777216'});
export const ANVIL_TRANSACTION_GAS_CAP_ERROR=Object.freeze({code:-32000,message:'intrinsic gas too high -- tx.gas_limit > env.cfg.tx_gas_limit_cap'});
const EMPTY_CODE_HASH=keccak256('0x');
const SAFE_ABI=[
  'function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address payable refundReceiver,bytes signatures) payable returns(bool success)'
];
const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

export function assertLoopbackRpcUrl(value){
  const url=new URL(value);
  assert.ok(['http:','https:'].includes(url.protocol),'Fork runner requires HTTP(S) JSON-RPC');
  assert.ok(['127.0.0.1','localhost','::1','[::1]'].includes(url.hostname),'Fork runner refuses non-loopback RPC');
  assert.equal(url.username,'','Fork RPC URL must not contain credentials');
  assert.equal(url.password,'','Fork RPC URL must not contain credentials');
  return url.toString();
}

export async function waitForTransactionReceipt({provider,transactionHash,attempts=120,pollIntervalMs=250,pause=delay}){
  assert.match(transactionHash,/^0x[0-9a-f]{64}$/i,'Transaction hash required while waiting for a receipt');
  assert.ok(Number.isSafeInteger(attempts)&&attempts>0,'Positive receipt polling attempt count required');
  assert.ok(Number.isSafeInteger(pollIntervalMs)&&pollIntervalMs>=0,'Non-negative receipt polling interval required');
  for(let attempt=0;attempt<attempts;attempt++){
    const receipt=await provider.send('eth_getTransactionReceipt',[transactionHash]);
    if(receipt)return receipt;
    if(attempt+1<attempts)await pause(pollIntervalMs);
  }
  throw Error(`Transaction receipt unavailable after ${attempts} attempts: ${transactionHash}`);
}

export function verifiedTransactionGasCapRejection(error,{gas,from,to}){
  assert.equal(error?.error?.code,ANVIL_TRANSACTION_GAS_CAP_ERROR.code,'Above-cap transaction failed without the pinned Anvil gas-cap error code');
  assert.equal(error?.error?.message,ANVIL_TRANSACTION_GAS_CAP_ERROR.message,'Above-cap transaction failed without the pinned Anvil gas-cap message');
  assert.equal(error?.payload?.method,'eth_sendTransaction','Gas-cap rejection did not originate from eth_sendTransaction');
  const [transaction]=error.payload.params??[];
  assert.equal(transaction?.gas,toQuantity(gas),'Gas-cap rejection payload has the wrong gas limit');
  assert.equal(transaction?.from?.toLowerCase(),from.toLowerCase(),'Gas-cap rejection payload has the wrong sender');
  assert.equal(transaction?.to?.toLowerCase(),to.toLowerCase(),'Gas-cap rejection payload has the wrong recipient');
  return {code:ANVIL_TRANSACTION_GAS_CAP_ERROR.code,message:ANVIL_TRANSACTION_GAS_CAP_ERROR.message};
}

export async function verifyTransactionGasCap({provider}){
  const cap=BigInt(ANVIL_FORK_PIN.transactionGasCap),probe='0x0000000000000000000000000000000000007825';
  const head=await provider.send('eth_getBlockByNumber',['latest',false]),gasPrice=BigInt(head.baseFeePerGas??0)+10n**9n;
  const snapshot=await provider.send('evm_snapshot',[]);let acceptedAtCap=false,rejection;
  try{
    await provider.send('anvil_setBalance',[probe,toQuantity((cap+1n)*gasPrice*2n)]);
    await provider.send('anvil_impersonateAccount',[probe]);
    const common={from:probe,to:probe,value:'0x0',gasPrice:toQuantity(gasPrice)};
    const acceptedHash=await provider.send('eth_sendTransaction',[{...common,gas:toQuantity(cap)}]);
    const acceptedReceipt=await waitForTransactionReceipt({provider,transactionHash:acceptedHash});
    assert.equal(BigInt(acceptedReceipt.status??0),1n,'Transaction at the EIP-7825 cap was not mined successfully');
    acceptedAtCap=true;
    try{
      const unexpectedHash=await provider.send('eth_sendTransaction',[{...common,gas:toQuantity(cap+1n)}]);
      throw Error(`Anvil accepted transaction above EIP-7825 cap: ${unexpectedHash}`);
    }catch(error){
      if(String(error?.message).startsWith('Anvil accepted transaction above'))throw error;
      rejection=verifiedTransactionGasCapRejection(error,{gas:cap+1n,from:probe,to:probe});
    }
  }finally{
    await provider.send('anvil_stopImpersonatingAccount',[probe]).catch(()=>{});
    assert.equal(await provider.send('evm_revert',[snapshot]),true,'Could not restore transaction-cap probe snapshot');
  }
  assert.ok(acceptedAtCap&&rejection,'EIP-7825 transaction-cap boundary was not observed');
  return {status:'OBSERVED_BOUNDARY',maximumAcceptedGas:cap.toString(),firstRejectedGas:(cap+1n).toString(),rejection};
}

export async function inspectPinnedAnvilFork({provider,forkBlock,forkHash,probeGasCap=verifyTransactionGasCap}){
  assert.ok(Number.isSafeInteger(forkBlock)&&forkBlock>0,'Positive pinned fork block required');
  assert.match(forkHash,/^0x[0-9a-f]{64}$/i,'Pinned fork hash required');
  const client=await provider.send('web3_clientVersion',[]);
  assert.match(client,/^anvil\/v1\.7\.1(?:\b|[-+])/i,'Pinned Anvil v1.7.1 required');
  assert.equal(BigInt(await provider.send('eth_chainId',[])),1n,'Fork must expose Ethereum chain ID 1');
  const nodeInfo=await provider.send('anvil_nodeInfo',[]);
  assert.equal(String(nodeInfo?.hardFork).toLowerCase(),ANVIL_FORK_PIN.hardfork,'Running Anvil hardfork differs from the pinned hardfork');
  const latest=await provider.send('eth_getBlockByNumber',['latest',false]);
  assert.equal(Number(BigInt(latest.number)),forkBlock,'Fork must be pristine at the pinned block');
  assert.equal(latest.hash.toLowerCase(),forkHash.toLowerCase(),'Fork head hash differs from the pinned mainnet block');
  const pinned=await provider.send('eth_getBlockByNumber',[toQuantity(forkBlock),false]);
  assert.equal(pinned?.hash?.toLowerCase(),forkHash.toLowerCase(),'Pinned block is unavailable or changed');
  assert.ok(pinned.baseFeePerGas!==undefined,'Pinned fork must support EIP-1559');
  const transactionGasCap=await probeGasCap({provider});
  const restored=await provider.send('eth_getBlockByNumber',['latest',false]);
  assert.equal(Number(BigInt(restored.number)),forkBlock,'Transaction-cap probe did not restore the pristine fork height');
  assert.equal(restored.hash.toLowerCase(),forkHash.toLowerCase(),'Transaction-cap probe did not restore the pristine fork hash');
  return {client,observedHardfork:String(nodeInfo.hardFork).toLowerCase(),transactionGasCap,blockNumber:forkBlock,
    blockHash:getAddressHash(forkHash),baseFeePerGas:BigInt(pinned.baseFeePerGas).toString(),gasLimit:BigInt(pinned.gasLimit).toString()};
}

function getAddressHash(value){return '0x'+value.slice(2).toLowerCase();}
const totalMaximumFee=manifest=>manifest.steps.reduce((sum,step)=>sum+BigInt(manifest.config.gasLimits[step.name]),0n)*BigInt(manifest.config.maxFeePerGas)+BigInt(manifest.config.balanceBufferWei);

export function validateForkExecutionEnvironment(environment,forkBlock,forkHash){
  assert.equal(environment?.format,1,'Anvil execution evidence format 1 required');
  assert.equal(environment?.kind,'MYCELIUM_PINNED_ANVIL_EXECUTION','Repository-managed Anvil execution evidence required');
  assert.match(environment?.binary?.sha256,/^[0-9a-f]{64}$/,'Running Anvil binary SHA-256 required');
  assert.equal(environment.binary.sha256,environment.binary.expectedSha256,'Running Anvil binary differs from the approved SHA-256');
  assert.equal(environment.binary.version,ANVIL_FORK_PIN.version,'Execution evidence has the wrong Anvil version');
  assert.equal(environment.binary.commit,ANVIL_FORK_PIN.commit,'Execution evidence has the wrong Anvil commit');
  assert.equal(environment?.launch?.manager,'REPOSITORY_MANAGED_CHILD_PROCESS','Anvil must be started by the repository-managed launcher');
  assert.ok(Number.isSafeInteger(environment.launch.port)&&environment.launch.port>=1024&&environment.launch.port<=65535,'Invalid Anvil loopback port evidence');
  const expectedArgs=['--fork-url','<REDACTED_UPSTREAM_MAINNET_RPC>','--fork-block-number',String(forkBlock),'--hardfork',ANVIL_FORK_PIN.hardfork,
    '--chain-id','1','--enable-tx-gas-limit','--no-storage-caching','--host','127.0.0.1','--port',String(environment.launch.port),'--silent'];
  assert.deepEqual(environment.launch.arguments,expectedArgs,'Anvil launch arguments differ from the required isolated fork');
  assert.equal(environment.launch.command,[environment.launch.executable,...expectedArgs].map(value=>JSON.stringify(value)).join(' '),'Sanitized Anvil launch transcript is inconsistent');
  assert.equal(environment.launch.chainId,1,'Execution evidence has the wrong chain ID');
  assert.equal(environment.launch.host,'127.0.0.1','Anvil must listen on IPv4 loopback only');
  assert.equal(environment.launch.hardfork,ANVIL_FORK_PIN.hardfork,'Execution evidence has the wrong hardfork');
  assert.equal(environment.launch.transactionGasCap,ANVIL_FORK_PIN.transactionGasCap,'Execution evidence omits the transaction gas cap');
  assert.equal(environment.launch.noStorageCaching,true,'Execution evidence must disable fork storage caching');
  assert.equal(environment?.blockConsensus?.status,'TWO_PROVIDER_FINALIZED_BLOCK_CONSENSUS','Two-provider finalized-block evidence required');
  assert.equal(environment.blockConsensus.blockNumber,forkBlock,'Execution evidence has the wrong fork block');
  assert.equal(environment.blockConsensus.blockHash.toLowerCase(),forkHash.toLowerCase(),'Execution evidence has the wrong fork hash');
  assert.equal(environment.blockConsensus.providers?.length,2,'Exactly two provider observations required');
  assert.notEqual(environment.blockConsensus.providers[0].hostname,environment.blockConsensus.providers[1].hostname,'Provider observations must use distinct hostnames');
  for(const provider of environment.blockConsensus.providers){
    assert.deepEqual(Object.keys(provider).sort(),['chainId','finalizedBlockHash','finalizedBlockNumber','hostname','pinnedBlockHash','port'].sort(),'Provider evidence contains unexpected or secret-bearing fields');
    assert.equal(provider.chainId,'1','Provider evidence has the wrong chain ID');
    assert.equal(provider.pinnedBlockHash.toLowerCase(),forkHash.toLowerCase(),'Provider evidence has the wrong pinned hash');
    assert.ok(Number.isSafeInteger(provider.finalizedBlockNumber)&&provider.finalizedBlockNumber>=forkBlock,'Provider did not prove the pinned block finalized');
  }
  return environment;
}

async function setBalance(provider,address,value){await provider.send('anvil_setBalance',[address,toQuantity(value)]);}
async function impersonate(provider,address){await provider.send('anvil_impersonateAccount',[address]);return provider.getSigner(address);}
async function stopImpersonating(provider,address){await provider.send('anvil_stopImpersonatingAccount',[address]);}
const wait=async transaction=>(await transaction).wait();

export function safePrevalidatedSignature(owner){
  const address=getAddress(owner).slice(2).toLowerCase();
  return `0x${address.padStart(64,'0')}${'0'.repeat(64)}01`;
}

async function safeExecute(safe,to,data,signer){
  return wait(safe.execTransaction(to,0,data,0,0,0,0,ZeroAddress,ZeroAddress,safePrevalidatedSignature(signer)));
}

function verificationInputs(manifest,compiled){
  const plan=deploymentPlan(manifest.config),artifacts={SVGHeaderStore:artifactFor(compiled,'contracts/core/generated/SVGConstants.sol','SVGHeaderStore')};
  for(const step of plan.steps)artifacts[step.name]=artifactFor(compiled,step.file,step.name);
  return {plan,addresses:manifest.addresses,artifacts};
}

export async function rehearseForkLifecycle({provider,manifest,compiled,safePolicy}){
  assert.ok(manifest.config.saleCap>=3,'Fork lifecycle requires saleCap of at least 3');
  const nftAddress=manifest.addresses.MyceliumFriends;
  const owner=getAddress(manifest.config.initialOwner),treasury=getAddress(manifest.config.treasury);
  const safeMode=Boolean(safePolicy);
  if(safeMode){assertSafeRoleBinding(manifest.config,safePolicy);assert.equal(safePolicy.preDeployState.threshold,1,'Current Safe lifecycle rehearsal requires its reviewed 1-of-1 PRE_DEPLOY state');}
  else assert.equal(manifest.config.roleCodeHashes.initialOwner,EMPTY_CODE_HASH,'Contract initial owner requires an explicit Safe policy');
  const controller=safeMode?getAddress(safePolicy.preDeployState.owners[0].address):owner;
  const candidates=['0x1000000000000000000000000000000000000001','0x2000000000000000000000000000000000000002','0x3000000000000000000000000000000000000003'].map(getAddress);
  const buyer=candidates.find(address=>![owner,controller,treasury,nftAddress].some(value=>value.toLowerCase()===address.toLowerCase()));
  const nextOwner=candidates.find(address=>address!==buyer&&![owner,controller,treasury,nftAddress].some(value=>value.toLowerCase()===address.toLowerCase()));
  assert.ok(buyer&&nextOwner,'Could not choose isolated fork actors');
  const ownerSigner=await impersonate(provider,controller),buyerSigner=await impersonate(provider,buyer),
    nextOwnerSigner=safeMode?null:await impersonate(provider,nextOwner);
  try{
    await setBalance(provider,controller,10n**20n);await setBalance(provider,buyer,10n**20n);
    if(!safeMode)await setBalance(provider,nextOwner,10n**20n);
    const artifact=artifactFor(compiled,'contracts/core/MyceliumFriends.sol','MyceliumFriends');
    const nft=new Contract(nftAddress,artifact.abi,ownerSigner),buyerNft=nft.connect(buyerSigner);
    const safe=safeMode?new Contract(owner,SAFE_ABI,ownerSigner):null;
    const admin=async(fragment,args=[])=>safeMode?safeExecute(safe,nftAddress,nft.interface.encodeFunctionData(fragment,args),controller):wait(nft[fragment](...args));
    let publicMintNumber=0;
    const preparePublicMint=async selection=>{
      const salt=toBeHex(++publicMintNumber,32),selections=[selection];
      const commitment=await buyerNft.makeCommitment(buyer,selections,salt);await wait(buyerNft.commit(commitment));
      await provider.send('evm_increaseTime',[60]);await provider.send('evm_mine',[]);
      return {selections,salt};
    };
    const revealPublicMint=({selections,salt},value)=>wait(buyerNft.revealMint(selections,salt,value,MaxUint256,{value}));
    await admin('setAllowlistAllocations',[[buyer],[1]]);await admin('startAllowlistSale');
    await wait(buyerNft.mint(...traitsForGenotypeIndex(0)));assert.equal(await nft.allowlistMinted(),1n);
    await admin('openPublicSale');await revealPublicMint(await preparePublicMint(traitsForGenotypeIndex(1)),0n);assert.equal(await nft.publicMinted(),1n);
    const price=await nft.mintPrice(1);assert.equal(price,100_000_000_000_000n,'Unexpected public price step on fork');
    const pausedMint=await preparePublicMint(traitsForGenotypeIndex(2));
    await admin('pausePublicSale');
    await assert.rejects(()=>buyerNft.revealMint.staticCall(pausedMint.selections,pausedMint.salt,price,MaxUint256,{value:price}));
    await admin('resumePublicSale');await revealPublicMint(pausedMint,price);
    const contractBalance=BigInt(await provider.send('eth_getBalance',[nftAddress,'latest']));assert.equal(contractBalance,price);
    const treasuryBefore=BigInt(await provider.send('eth_getBalance',[treasury,'latest']));await wait(buyerNft.withdraw());
    const treasuryAfter=BigInt(await provider.send('eth_getBalance',[treasury,'latest']));assert.equal(treasuryAfter-treasuryBefore,contractBalance,'Treasury received the wrong withdrawal amount');
    let control;
    if(safeMode){
      assert.equal(await nft.owner(),owner,'Collection owner address changed during Safe administration');
      const lifecyclePolicy={...safePolicy,preDeployState:{...safePolicy.preDeployState,nonce:(BigInt(safePolicy.preDeployState.nonce)+5n).toString()}};
      const safeControl=await inspectSafePolicy({provider,policy:lifecyclePolicy});
      control={mode:'SAFE_1_OF_1',collectionOwner:owner,safeOwner:controller,ownerSetUnchanged:true,safeControl};
    }else{
      await wait(nft.transferOwnership(nextOwner));assert.equal(await nft.pendingOwner(),nextOwner);
      await wait(nft.connect(nextOwnerSigner).acceptOwnership());assert.equal(await nft.owner(),nextOwner);
      control={mode:'EOA',previousCollectionOwner:owner,nextCollectionOwner:nextOwner,ownershipAccepted:true};
    }
    assert.ok((await nft.tokenURI(1,{gasLimit:50_000_000})).startsWith('data:application/json;base64,'),'Fork metadata call failed');
    const liveHealth=await verifyLiveDeployment({provider,manifest,artifact});
    return {buyer,nextOwner,allowlistMinted:'1',publicMinted:'2',withdrawnWei:contractBalance.toString(),control,metadataCallGasLimit:'50000000',liveHealth};
  }finally{
    if(!safeMode)await stopImpersonating(provider,nextOwner);
    await stopImpersonating(provider,buyer);await stopImpersonating(provider,controller);
  }
}

export async function rehearseMainnetFork({provider,manifest,expectedDigest,compiled,forkBlock,forkHash,safePolicy,executionEnvironment,
  assertSource=()=>assert.deepEqual(sourceIdentity(),manifest.source,'Sources changed during fork rehearsal')}){
  validateMainnetBroadcastManifest(manifest,expectedDigest);
  validateForkExecutionEnvironment(executionEnvironment,forkBlock,forkHash);
  if(manifest.config.roleCodeHashes.initialOwner!==EMPTY_CODE_HASH)assert.ok(safePolicy,'Contract initial owner requires an explicit Safe policy');
  const fork=await inspectPinnedAnvilFork({provider,forkBlock,forkHash});
  const safeControl=safePolicy?(assertSafeRoleBinding(manifest.config,safePolicy),await inspectSafePolicy({provider,policy:safePolicy})):undefined;
  const rootCheckpoint=await provider.send('evm_snapshot',[]);
  try{
    const funded=totalMaximumFee(manifest)+10n**18n;await setBalance(provider,manifest.config.deployer,funded);
    await inspectProductionNetwork({manifest,provider,deployer:manifest.config.deployer,safePolicy});
    const deployer=await impersonate(provider,manifest.config.deployer);let deployment;
    try{
      deployment=await broadcastPreparedManifest({manifest,expectedDigest,provider,signer:deployer,confirmations:1,
        validateManifest:validateMainnetBroadcastManifest});
    }finally{await stopImpersonating(provider,manifest.config.deployer);}
    const verification=verificationInputs(manifest,compiled);
    const untouched=await verifyDeployment({provider,...verification});
    const checkpoint=await provider.send('evm_snapshot',[]);let lifecycle;
    try{lifecycle=await rehearseForkLifecycle({provider,manifest,compiled,safePolicy});}
    finally{assert.equal(await provider.send('evm_revert',[checkpoint]),true,'Could not restore untouched deployment checkpoint');}
    const restored=await verifyDeployment({provider,...verification});
    assert.deepEqual(restored,untouched,'Restored fork no longer matches untouched deployment');
    const restoredSafeControl=safePolicy?await inspectSafePolicy({provider,policy:safePolicy}):undefined;
    await assertSource();
    const approvedGasLimit=manifest.steps.reduce((sum,step)=>sum+BigInt(manifest.config.gasLimits[step.name]),0n);
    const actualGasUsed=deployment.receipts.reduce((sum,receipt)=>sum+BigInt(receipt.gasUsed),0n);
    const actualFeeWei=deployment.receipts.reduce((sum,receipt)=>sum+BigInt(receipt.gasUsed)*BigInt(receipt.effectiveGasPrice),0n);
    return {format:1,kind:'MYCELIUM_MAINNET_FORK_REHEARSAL',status:'FORK_REHEARSAL_COMPLETE_NOT_MAINNET_BROADCAST',
      releaseDigest:manifest.digest,anvil:ANVIL_FORK_PIN,executionEnvironment,fork,safeControl,fundedDeployerWei:funded.toString(),deployment:{...deployment,status:'FORK_DEPLOYMENT_RUNTIME_VERIFIED'},
      budget:{approvedGasLimit:approvedGasLimit.toString(),maxFeePerGas:manifest.config.maxFeePerGas,balanceBufferWei:manifest.config.balanceBufferWei,
        maximumFeeWei:(approvedGasLimit*BigInt(manifest.config.maxFeePerGas)+BigInt(manifest.config.balanceBufferWei)).toString(),
        actualGasUsed:actualGasUsed.toString(),actualFeeWei:actualFeeWei.toString()},
      untouchedVerification:untouched,lifecycle,restoredSafeControl,restoredUntouched:true,rootForkRestored:true};
  }finally{assert.equal(await provider.send('evm_revert',[rootCheckpoint]),true,'Could not restore the pristine fork root');}
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  throw Error('Direct fork execution is disabled. Use npm run release:fork so the repository-managed launcher can prove the Anvil binary, arguments and upstream consensus.');
}
