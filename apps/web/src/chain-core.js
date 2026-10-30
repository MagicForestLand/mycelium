import {Interface, ZeroAddress, isAddress} from 'ethers';
import {MINT_PRICE_STEP} from './mint-price.js';

export const ABI = [
  'function COMMITMENT_DOMAIN() view returns(bytes32)',
  'function MIN_COMMITMENT_AGE() view returns(uint256)', 'function MAX_COMMITMENT_AGE() view returns(uint256)',
  'function commitments(address,bytes32) view returns(uint256)',
  'function commit(bytes32)',
  'function makeCommitment(address,uint256[6][],bytes32) view returns(bytes32)',
  'function revealMint(uint256[6][],bytes32,uint256,uint256) payable returns(uint256[])',
  'function mintBatch(uint256[6][]) payable returns(uint256[])',
  'event CommitmentSubmitted(address indexed buyer,bytes32 indexed commitment,uint256 timestamp)',
  'event CommitmentConsumed(address indexed buyer,bytes32 indexed commitment)',
  'event MintRefunded(address indexed buyer,uint256 amount)',
  'error CommitmentNotReady()', 'error CommitmentExpired()',
  'error CommitmentActive()', 'error InvalidCommitment()', 'error MintDeadlineExpired()',
  'error RefundFailed()', 'error PriceAboveMaximum(uint256 actual,uint256 maximum)',
  'function totalMinted() view returns(uint256)', 'function publicMinted() view returns(uint256)',
  'function allowlistMinted() view returns(uint256)', 'function salePhase() view returns(uint8)',
  'function saleCap() view returns(uint256)', 'function mintPrice(uint256) view returns(uint256)',
  'function allowlistAllocation(address) view returns(uint256)',
  'function allowlistClaimed(address) view returns(uint256)', 'function isAvailable(uint256,uint256,uint256,uint256,uint256,uint256) view returns(bool)',
  'function genotypeForTraits(uint256,uint256,uint256,uint256,uint256,uint256) pure returns(uint48)',
  'function tokenForTraits(uint256,uint256,uint256,uint256,uint256,uint256) view returns(uint256)',
  'function genotypeOf(uint256) view returns(uint48)',
  'function mint(uint256,uint256,uint256,uint256,uint256,uint256) payable',
  'function ownerOf(uint256) view returns(address)', 'function tokenURI(uint256) view returns(string)',
  'event Minted(address indexed buyer,uint256 indexed firstMintNumber,uint256 quantity,uint256 paid)',
  'event GenotypeAssigned(uint256 indexed tokenId,uint48 genotype)',
  'event PublicSaleOpened(uint256 allowlistMinted)',
  'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)',
  'error IncorrectPayment(uint256 required,uint256 received)', 'error CombinationAlreadyMinted(uint256 tokenId)',
  'error AllowlistAllocationExceeded()', 'error SoldOut()', 'error PublicSaleNotOpen()', 'error InvalidSalePhase()', 'error InvalidTrait(uint256 layer,uint256 index)'
];
export const chainInterface = new Interface(ABI);
export const PRICE_STEP = MINT_PRICE_STEP;
export const SALE_LIFECYCLE = 'phased-v1';
export const CHAIN_SNAPSHOT_FORMAT = 'mycelium-snapshot-20261023';
export const CHAIN_CACHE_PREFIX = `myfriends:snapshot:${CHAIN_SNAPSHOT_FORMAT}:`;
export function deploymentKey(d) { return `${CHAIN_CACHE_PREFIX}${d.chainId}:${d.address.toLowerCase()}:${d.deploymentHash}`; }
export function tokenExplorerURL(deployment,tokenId){
  if(!deployment?.explorerUrl||!isAddress(deployment.address)||!/^\d+$/.test(String(tokenId)))throw Error('Invalid token explorer link.');
  const explorer=new URL(deployment.explorerUrl),base=explorer.href.replace(/\/$/,'');
  return explorer.hostname==='etherscan.io'||explorer.hostname.endsWith('.etherscan.io')
    ?`${base}/nft/${deployment.address}/${tokenId}`
    :`${base}/token/${deployment.address}/instance/${tokenId}`;
}
export function allowlistMessage(allocation,claimed) {
  allocation=Number(allocation);claimed=Number(claimed);
  if(!Number.isSafeInteger(allocation)||!Number.isSafeInteger(claimed)||allocation<0||claimed<0)throw Error('Invalid allowlist status.');
  if(allocation===0)return claimed===0?'This wallet has no allowlist mints.':`This wallet has no allowlist mints. ${claimed} ${claimed===1?'myFriend was':'myFriends were'} claimed before its allocation changed.`;
  const remaining=Math.max(0,allocation-claimed),friends=allocation===1?'myFriend':'myFriends',verb=claimed===1?'has':'have';
  if(remaining===0)return claimed===allocation?`Allowlist complete · ${claimed} of ${allocation} ${friends} ${verb} found a home.`:
    `Allowlist complete · ${claimed} ${claimed===1?'myFriend has':'myFriends have'} found a home. This wallet’s current allocation is ${allocation}.`;
  if(claimed===0)return allocation===1?'One allowlist myFriend is waiting for this wallet.':`${allocation} allowlist myFriends are waiting for this wallet.`;
  const left=remaining===1?'One allowlist mint remains':`${remaining} allowlist mints remain`;
  return `${left} · ${claimed} of ${allocation} ${friends} ${verb} found a home.`;
}
export function validateDeployment(d) {
  if (d?.mintProtocol!=='commit-reveal-v1')throw Error('This deployment does not use the current protected mint protocol.');
  if (d?.saleLifecycle!==SALE_LIFECYCLE)throw Error('This deployment does not use the current phased sale lifecycle.');
  if (!d || !/^[a-z0-9-]+$/.test(d.id) || !isAddress(d.address) || d.address === ZeroAddress) throw Error('Invalid collection deployment.');
  if(typeof d.label!=='string'||!d.label.trim()||typeof d.networkName!=='string'||!d.networkName.trim())throw Error('Set the collection label and network name.');
  if (![1,11155111,31337].includes(d.chainId)) throw Error('Unsupported network.');
  if (!Number.isSafeInteger(d.deploymentBlock) || d.deploymentBlock < 0) throw Error('Invalid deployment block.');
  for (const key of ['deploymentHash','codeHash']) if (!/^0x[\da-f]{64}$/i.test(d[key])) throw Error(`Missing ${key}.`);
  if (!/^[\da-f]{64}$/i.test(d.catalogHash)) throw Error('Missing catalog fingerprint.');
  const rpc = new URL(d.rpcUrl);
  if (rpc.protocol !== 'https:' && !(d.chainId===31337 && rpc.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(rpc.hostname))) throw Error('Use HTTPS for public RPC endpoints.');
  if (d.explorerUrl && new URL(d.explorerUrl).protocol!=='https:') throw Error('Use HTTPS for the explorer.');
  if(d.explorers!==undefined){
    if(!d.explorers||typeof d.explorers!=='object'||Array.isArray(d.explorers))throw Error('Invalid explorer configuration.');
    const keys=Object.keys(d.explorers).sort();if(keys.join(',')!=='etherscan,evmNow')throw Error('Production explorers must be Etherscan and EVM.NOW.');
    for(const value of Object.values(d.explorers))if(new URL(value).protocol!=='https:')throw Error('Use HTTPS for explorers.');
    if(d.explorerUrl&&d.explorerUrl.replace(/\/$/,'')!==d.explorers.etherscan.replace(/\/$/,''))throw Error('Primary explorer must be Etherscan.');
  }
  if (d.snapshotUrl && new URL(d.snapshotUrl).protocol!=='https:') throw Error('Use HTTPS for the snapshot API.');
  if (d.mintEvidenceUrl && new URL(d.mintEvidenceUrl).protocol!=='https:') throw Error('Use HTTPS for the mint evidence API.');
  return d;
}

// Index successful primary mints and current ownership. Later transfers never grow the spiral.
// Minted reserves a chronological range BEFORE the corresponding Transfer logs.
export function appendMintLogs(previous, logs) {
  const records = previous.records.map(record=>({...record}));
  const byToken=new Map(records.map(record=>[record.tokenId,record]));
  let publicOpen = previous.publicOpen;
  let publicCount = records.filter(r=>r.phase==='public').length;
  let pending = null;
  for (const log of [...logs].sort((a,b)=>a.blockNumber-b.blockNumber || a.index-b.index)) {
    let event; try { event=chainInterface.parseLog(log); } catch { continue; }
    if (!event) continue;
    if (event.name==='PublicSaleOpened') { publicOpen=true; continue; }
    if (event.name==='Minted') {
      if (pending) throw Error('Incomplete mint event range.');
      const {buyer,firstMintNumber,quantity,paid}=event.args;
      if (Number(firstMintNumber)!==records.length+1) throw Error('Mint history has a gap.');
      pending={buyer,first:Number(firstMintNumber),quantity:Number(quantity),paid,seen:0,hash:log.transactionHash,assigned:null};
    }
    if (event.name==='GenotypeAssigned') {
      if (!pending || pending.hash!==log.transactionHash || pending.assigned) throw Error('Unmatched genotype assignment.');
      const expected=BigInt(pending.first+pending.seen);
      if(event.args.tokenId!==expected)throw Error('Genotype assignment is out of order.');
      pending.assigned={tokenId:event.args.tokenId,genotype:Array.from({length:6},(_,i)=>Number((event.args.genotype>>BigInt(i*8))&255n))};
    }
    if (event.name==='Transfer') {
      const tokenId=event.args.tokenId.toString();
      if(event.args.from===ZeroAddress){
        if (!pending || pending.hash!==log.transactionHash || pending.buyer.toLowerCase()!==event.args.to.toLowerCase()) throw Error('Unmatched mint transfer.');
        if(!pending.assigned || pending.assigned.tokenId!==event.args.tokenId)throw Error('Mint transfer is missing its genotype.');
        const price=publicOpen ? PRICE_STEP*BigInt(publicCount++) : pending.paid/BigInt(pending.quantity);
        const record={tokenId,phase:publicOpen?'public':'allowlist',price:price.toString(),step:publicOpen?publicCount:0,
          buyer:pending.buyer,owner:event.args.to,transactionHash:log.transactionHash,blockNumber:log.blockNumber,genotype:pending.assigned.genotype};
        records.push(record);byToken.set(tokenId,record);
        pending.assigned=null;if (++pending.seen===pending.quantity) pending=null;
      }else{
        const record=byToken.get(tokenId);
        if(record)record.owner=event.args.to;
      }
    }
  }
  if (pending) throw Error('Incomplete mint transfers.');
  return {records,publicOpen};
}
export function mintReceiptToken(receipt,address,buyer,tokenId) {
  const minted=mintReceiptTokenId(receipt,address,buyer);return minted!==null&&minted===BigInt(tokenId);
}
// A quoted sequential ID is not a reservation, including during the free allowlist phase.
export function mintReceiptForGenotype(receipt,address,buyer,genotype) {
  if (Number(receipt.status)!==1) throw Error('The transaction reverted. No myFriend was minted.');
  if(!Array.isArray(genotype)||genotype.length!==6||genotype.some(v=>!Number.isInteger(v)||v<0||v>255))return null;
  const packed=genotype.reduce((n,v,i)=>n|(BigInt(v)<<BigInt(i*8)),0n);
  const assigned=new Set(),minted=new Set();
  for(const log of receipt.logs){
    if(log.address.toLowerCase()!==address.toLowerCase())continue;
    let e;try{e=chainInterface.parseLog(log);}catch{continue;}
    if(e?.name==='GenotypeAssigned'&&e.args.genotype===packed)assigned.add(e.args.tokenId.toString());
    if(e?.name==='Transfer'&&e.args.from===ZeroAddress&&e.args.to.toLowerCase()===buyer.toLowerCase())minted.add(e.args.tokenId.toString());
  }
  const matches=[...assigned].filter(id=>minted.has(id));
  return matches.length===1?BigInt(matches[0]):null;
}
export function mintReceiptPayment(receipt,address,buyer,tokenId) {
  if (Number(receipt.status)!==1) throw Error('The transaction reverted. No myFriend was minted.');
  tokenId=BigInt(tokenId);
  for(const log of receipt.logs){
    if(log.address.toLowerCase()!==address.toLowerCase())continue;
    let event;try{event=chainInterface.parseLog(log);}catch{continue;}
    if(event?.name!=='Minted'||event.args.buyer.toLowerCase()!==buyer.toLowerCase())continue;
    const first=event.args.firstMintNumber,quantity=event.args.quantity;
    if(tokenId>=first&&tokenId<first+quantity)return {paid:event.args.paid,quantity};
  }
  return null;
}
export function mintReceiptTokenId(receipt,address,buyer) {
  if (Number(receipt.status)!==1) throw Error('The transaction reverted. No myFriend was minted.');
  for(const log of receipt.logs){
    if (log.address.toLowerCase()!==address.toLowerCase()) continue;
    try { const e=chainInterface.parseLog(log);if(e?.name==='Transfer'&&e.args.from===ZeroAddress&&e.args.to.toLowerCase()===buyer.toLowerCase())return e.args.tokenId; } catch {}
  }
  return null;
}
export function friendlyError(error) {
  const code=error?.code ?? error?.error?.code;
  const raw=[error?.shortMessage,error?.message,error?.info?.error?.message,error?.error?.message].filter(Boolean).join(' ');
  let name='';
  for (const data of [error?.data,error?.info?.error?.data?.result,error?.info?.error?.data,error?.error?.data]) {
    if (typeof data==='string') { try { name=chainInterface.parseError(data)?.name || name; } catch {} }
  }
  if (code===4001 || code==='ACTION_REJECTED' || /user rejected|user denied/i.test(raw)) return 'You cancelled in your wallet. Nothing was sent. You can try again.';
  if (code===-32002) return 'A request is already open in your wallet. Open it to continue.';
  if (code==='INSUFFICIENT_FUNDS' || /insufficient funds/i.test(raw)) return 'You’re nearly there. Add enough ETH to your wallet for the mint and network gas, then return to your friend.';
  if (/IncorrectPayment/.test(name+raw)) return 'The mint price changed while you were confirming. Refresh the quote and try again.';
  if (/CombinationAlreadyMinted/.test(name+raw)) return 'This friend has just found a home. Your look is saved. Change a trait or discover another available friend.';
  if (/AllowlistAllocationExceeded/.test(name+raw)) return 'This wallet has no allowlist claims left. Try your eligible wallet or wait for public mint.';
  if (/InvalidSalePhase/.test(name+raw)) return 'Minting is not available in the current sale phase. Refresh the collection status and try again.';
  if (/SoldOut/.test(name+raw)) return 'Every myFriend has found a home. Explore the forest to meet them.';
  if (/PublicSaleNotOpen/.test(name+raw)) return 'The public mint hasn’t opened yet. Come back soon to meet your friend.';
  if (/current protected mint protocol|current phased sale lifecycle/i.test(raw)) return 'This configured deployment is retired. Select or deploy the current collection before minting.';
  if (code==='NETWORK_ERROR' || code==='TIMEOUT' || /fetch|timeout|network|ECONNREFUSED/i.test(raw)) return 'The network is taking a break. Your selection is saved. Please retry shortly.';
  if (code==='CALL_EXCEPTION') return 'The contract could not complete this mint. Refresh the quote and check your wallet’s eligibility.';
  if (/^(Allowlist|This friend|This myFriend|This wallet|Your wallet changed|Your wallet and the collection|Switch your wallet|Connect your wallet|The forest|The collection|Your transaction|The transaction was|This transaction did not|Minting|Public minting)/.test(raw) && !/0x[\da-f]{64}|execution reverted/i.test(raw)) return raw;
  return 'Your friend is saved. We couldn’t complete this step just yet. Please try again in a moment.';
}
