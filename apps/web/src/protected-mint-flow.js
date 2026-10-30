import {Contract,keccak256} from 'ethers';
import {ABI,mintReceiptForGenotype} from './chain-core.js';
import {COMMITMENT_DOMAIN,MIN_AGE,MAX_AGE,DEADLINE_SECONDS,maximumPayment,protectionState,intentPrefix,makeLocalCommitment} from './mint-protection.js';
const PUBLIC_ACTIVE=2n;
// Carry only safe error categories to the view, never transaction calldata/salt.
function failureCode(error,iface){
  if(['ACTION_REJECTED','INSUFFICIENT_FUNDS',4001,-32002].includes(error?.code))return error.code;
  for(const data of [error?.data,error?.info?.error?.data?.result,error?.info?.error?.data]){
    if(typeof data!=='string')continue;
    try{const name=iface.parseError(data)?.name;if(['CombinationAlreadyMinted','SoldOut','PriceAboveMaximum','MintDeadlineExpired','PublicSaleNotOpen'].includes(name))return name;}catch{}
  }
}

// Transport-independent state machine. Only sendCommit/sendReveal can prompt a wallet.
export class ProtectedMintFlow {
  constructor({deployment,provider,store,record,getSigner,locks=globalThis.navigator?.locks,onChange=()=>{},isCurrent=()=>true}){
    Object.assign(this,{deployment,provider,store,record,getSigner,locks,onChange,isCurrent});
    this.contract=new Contract(deployment.address,ABI,provider);this.active=false;this.quote=null;
  }
  assertCurrent(){
    if(this.isCurrent()===true)return;
    const error=Error('Mint review closed or wallet changed. Review this mint again.');error.code='MINT_FLOW_CANCELLED';throw error;
  }
  save(patch){
    const latest=this.store.read(this.record.hash);
    if(JSON.stringify(latest)!==JSON.stringify(this.record))throw Error('Recovery changed in another tab. Reopen this mint before continuing.');
    this.record=this.store.save({...this.record,...patch});this.onChange();
  }
  async head(){const n=Number(BigInt(await this.provider.send('eth_blockNumber',[])));return this.provider.getBlock(n);}
  async verify(){
    const [network,code,block,domain,min,max]=await Promise.all([this.provider.getNetwork(),this.provider.getCode(this.deployment.address),this.provider.getBlock(this.deployment.deploymentBlock),this.contract.COMMITMENT_DOMAIN(),this.contract.MIN_COMMITMENT_AGE(),this.contract.MAX_COMMITMENT_AGE()]);
    if(Number(network.chainId)!==this.record.chainId||keccak256(code)!==this.record.codeHash||block?.hash!==this.record.deploymentHash||domain!==COMMITMENT_DOMAIN||min!==BigInt(MIN_AGE)||max!==BigInt(MAX_AGE))throw Error('The verified collection or protection protocol changed.');
  }
  async writable(){
    const signer=await this.getSigner();
    if((await signer.getAddress()).toLowerCase()!==this.record.buyer.toLowerCase()||Number((await signer.provider.getNetwork()).chainId)!==this.record.chainId)throw Error('Reconnect the original wallet and network.');
    const code=await signer.provider.getCode(this.deployment.address);
    if(keccak256(code)!==this.record.codeHash)throw Error('The wallet is connected to a different collection.');
    return new Contract(this.deployment.address,ABI,signer);
  }
  async locked(action){
    if(this.active)throw Error('A wallet request is already in progress.');
    if(!this.locks?.request)throw Error('Use a browser with Web Locks support to send a protected mint safely across tabs.');
    this.active=true;this.onChange();
    try{return await this.locks.request(intentPrefix(this.record),{ifAvailable:true},async lock=>{
      if(!lock)throw Error('This wallet has a mint request open in another tab.');
      this.record=this.store.read(this.record.hash);if(!this.record)throw Error('Restore your recovery record first.');
      return action();
    });}finally{this.active=false;this.onChange();}
  }
  matches(tx,phase){
    if(tx.from?.toLowerCase()!==this.record.buyer.toLowerCase()||tx.to?.toLowerCase()!==this.record.collection.toLowerCase())return false;
    try{
      const parsed=this.contract.interface.parseTransaction({data:tx.data??tx.input,value:tx.value});
      if(phase==='commit')return parsed.name==='commit'&&parsed.args[0]===this.record.hash;
      return parsed.name==='revealMint'&&makeLocalCommitment({...this.record,selections:parsed.args[0],salt:parsed.args[1]})===this.record.hash;
    }catch{return false;}
  }
  receiptMatches(receipt,phase){
    if(Number(receipt.status)!==1)return false;
    const name=phase==='commit'?'CommitmentSubmitted':'CommitmentConsumed';
    const matched=(receipt.logs||[]).some(log=>{
      if(log.address.toLowerCase()!==this.record.collection.toLowerCase())return false;
      try{const event=this.contract.interface.parseLog(log);return event?.name===name&&event.args.buyer.toLowerCase()===this.record.buyer.toLowerCase()&&event.args.commitment===this.record.hash;}catch{return false;}
    });
    return matched&&(phase==='commit'||this.record.selections.every(s=>mintReceiptForGenotype(receipt,this.record.collection,this.record.buyer,s)!==null));
  }
  async outcome(phase,head){
    const field=phase+'Tx',attempt=this.record[field];if(!attempt)return null;
    let hash=attempt.hash;
    if(!hash){
      // Recover unknown submission or a replacement by sender+nonce using public blocks only.
      const last=await this.provider.getTransactionCount(this.record.buyer,head.number);
      if(last<=attempt.nonce)return {state:'unknown'};
      for(let n=head.number;n>=Math.max(attempt.fromBlock,head.number-255);n--){
        const block=await this.provider.send('eth_getBlockByNumber',['0x'+n.toString(16),true]);
        const tx=block?.transactions.find(tx=>tx.from.toLowerCase()===this.record.buyer.toLowerCase()&&Number(BigInt(tx.nonce))===attempt.nonce);
        if(tx){hash=tx.hash;break;}
      }
      if(!hash)return {state:'unknown'};
      this.save({[field]:{...attempt,hash}});
    }
    const receipt=await this.provider.getTransactionReceipt(hash);
    if(!receipt){
      if(await this.provider.getTransactionCount(this.record.buyer,head.number)>attempt.nonce){this.save({[field]:{...attempt,hash:null}});return this.outcome(phase,head);}
      return {state:await this.provider.getTransaction(hash)?'pending':'unknown'};
    }
    const block=await this.provider.getBlock(receipt.blockNumber);
    if(block?.hash!==receipt.blockHash)return {state:'pending'};
    // Wallets may wrap the call in a delegation transaction. The canonical
    // collection's exact buyer + commitment + mint events prove its result.
    if(this.receiptMatches(receipt,phase))return {state:'confirmed',receipt};
    const tx=await this.provider.getTransaction(hash);
    if(!tx)return {state:'unknown'};
    if(tx.nonce!==attempt.nonce||!this.matches(tx,phase))return {state:'cancelled'};
    return {state:Number(receipt.status)===1?'confirmed':'failed',receipt};
  }
  async recoverConsumed(head){
    // Older clients discarded successful wrapped reveal hashes. Recover using
    // public commitment events only, without disclosing traits or salt to RPC.
    if(!this.record.exposed||this.record.revealTx)return null;
    const topics=this.contract.interface.encodeFilterTopics('CommitmentConsumed',[this.record.buyer,this.record.hash]);
    const start=this.record.commitTx?.fromBlock??this.deployment.deploymentBlock;
    for(let from=start;from<=head.number;from+=4000){
      const logs=await this.provider.getLogs({address:this.record.collection,topics,fromBlock:from,toBlock:Math.min(head.number,from+3999)});
      for(const log of logs){
        const receipt=await this.provider.getTransactionReceipt(log.transactionHash);
        if(!receipt||!this.receiptMatches(receipt,'reveal'))continue;
        const block=await this.provider.getBlock(receipt.blockNumber);
        if(block?.hash!==receipt.blockHash)continue;
        const tx=await this.provider.getTransaction(log.transactionHash);
        if(!tx)throw Error('Your mint is confirming. Please check again shortly.');
        this.save({state:'minted',revealTx:{hash:log.transactionHash,nonce:tx.nonce,fromBlock:receipt.blockNumber}});
        return {state:'confirmed',receipt};
      }
    }
    return null;
  }
  async sync(onProgress=()=>{}){
    onProgress('Verifying the collection…');
    await this.verify();
    onProgress('Reading the latest block…');
    const head=await this.head();
    onProgress('Checking wallet activity…');
    const reveal=await this.outcome('reveal',head)||await this.recoverConsumed(head);
    if(reveal){
      if(['unknown','pending'].includes(reveal.state))return {state:reveal.state,phase:'reveal',head};
      if(reveal.state==='confirmed'){
        const ids=this.record.selections.map(s=>mintReceiptForGenotype(reveal.receipt,this.record.collection,this.record.buyer,s));
        if(ids.some(id=>id===null))throw Error('The receipt did not mint this complete selection. Check the transaction in your wallet.');
        this.save({state:'minted'});return {state:'minted',receipt:reveal.receipt,ids,head};
      }
      this.save({state:'exposed',exposed:true,revealTx:null});
    }
    const commit=await this.outcome('commit',head);
    if(commit&&['unknown','pending'].includes(commit.state))return {state:commit.state,phase:'commit',head};
    if(commit&&['failed','cancelled'].includes(commit.state))this.save({commitTx:null,state:'saved'});
    onProgress('Checking your mint status…');
    const timestamp=await this.contract.commitments(this.record.buyer,this.record.hash,{blockTag:head.number});
    const state=protectionState(timestamp,head.timestamp);
    this.save({state:state==='missing'?'saved':state});
    return {state,timestamp,head,remaining:state==='waiting'?Number(timestamp)+MIN_AGE-head.timestamp:0};
  }
  async attachTransaction(hash,phase){
    if(!/^0x[0-9a-f]{64}$/i.test(hash)||!['commit','reveal'].includes(phase))throw Error('Enter a valid transaction hash.');
    const tx=await this.provider.getTransaction(hash),attempt=this.record[phase+'Tx'];
    if(!attempt)throw Error('That transaction does not match this protection attempt.');
    if(!tx||tx.nonce!==attempt.nonce||!this.matches(tx,phase)){
      const receipt=await this.provider.getTransactionReceipt(hash);
      const block=receipt&&await this.provider.getBlock(receipt.blockNumber);
      if(!receipt||block?.hash!==receipt.blockHash||!this.receiptMatches(receipt,phase))throw Error('That transaction does not match this protection attempt.');
    }
    this.save({[phase+'Tx']:{...attempt,hash}});return this.sync();
  }
  async confirmNotSent(phase){return this.locked(async()=>{
    if(!['commit','reveal'].includes(phase))throw Error('Invalid recovery phase.');
    const attempt=this.record[phase+'Tx'];if(!attempt)throw Error('No unknown request to recover.');
    const [latest,pending]=await Promise.all([this.provider.getTransactionCount(this.record.buyer,'latest'),this.provider.getTransactionCount(this.record.buyer,'pending')]);
    if(latest!==attempt.nonce||pending!==attempt.nonce)throw Error('The nonce is pending or consumed. Recover its transaction hash instead.');
    if(attempt.hash&&await this.provider.getTransaction(attempt.hash))throw Error('The network still knows this transaction.');
    this.save({[phase+'Tx']:null,state:phase==='commit'?'saved':'exposed'});
    this.quote=null;
  });}
  async submit(phase,c,send){
    const field=phase+'Tx',head=await this.head(),nonce=await c.runner.getNonce('pending');
    this.assertCurrent();
    this.save({state:phase+'-signing',[field]:{hash:null,nonce,fromBlock:head.number}});
    try{
      const tx=await send(nonce);this.save({state:phase+'-pending',[field]:{hash:tx.hash,nonce:tx.nonce,fromBlock:head.number}});
      // Never resend on timeout/replacement. sync() reconciles canonical receipts and nonce.
      return tx;
    }catch(error){
      if(error.code==='ACTION_REJECTED'||error.code===4001)this.save({state:phase==='commit'?'saved':'exposed',[field]:null});
      const failure=Error(phase==='reveal'?'Your myFriend is now public. Review protection and transaction status before retrying.':'Check your wallet and protection status. An unknown submission will not be sent again automatically.');
      failure.code=failureCode(error,this.contract.interface);
      throw failure;
    }
  }
  async sendCommit(){return this.locked(async()=>{
    const status=await this.sync();if(status.state!=='missing')throw Error('This protection is already submitted or needs recovery.');
    if(await this.contract.salePhase()!==PUBLIC_ACTIVE)throw Error('Public minting is not active right now.');
    const c=await this.writable();await c.commit.staticCall(this.record.hash);
    const gas=await c.commit.estimateGas(this.record.hash);
    return this.submit('commit',c,nonce=>c.commit(this.record.hash,{nonce,gasLimit:gas*120n/100n}));
  });}
  async review(buffer=0){
    const status=await this.sync();if(status.state!=='ready')throw Error('Wait for mature protection before reviewing a reveal.');
    const {head}=status,opts={blockTag:head.number},q=this.record.selections.length;
    const [price,total,cap,phase]=await Promise.all([this.contract.mintPrice(q,opts),this.contract.totalMinted(opts),this.contract.saleCap(opts),this.contract.salePhase(opts)]);
    if(phase!==PUBLIC_ACTIVE)throw Error('Public minting is temporarily unavailable.');
    if(BigInt(buffer)>cap-total-BigInt(q))throw Error('The selected buffer exceeds remaining supply.');
    this.quote={hash:this.record.hash,price,maximum:maximumPayment(price,q,buffer),buffer,quantity:q,deadline:head.timestamp+DEADLINE_SECONDS,block:head.number,remaining:cap-total-BigInt(q)};
    this.save({reviews:[...this.record.reviews,{price:String(price),maximum:String(this.quote.maximum),quantity:q,buffer,deadline:this.quote.deadline}].slice(-20)});
    return this.quote;
  }
  setBuffer(buffer){
    const q=this.quote;
    if(!q||BigInt(buffer)>q.remaining)throw Error('Choose a smaller price limit.');
    const maximum=maximumPayment(q.price,q.quantity,buffer);
    this.quote={...q,buffer,maximum};
    this.save({reviews:[...this.record.reviews,{price:String(q.price),maximum:String(maximum),quantity:q.quantity,buffer,deadline:q.deadline}].slice(-20)});
    return this.quote;
  }
  async sendReveal(quote){return this.locked(async()=>{
    if(!quote||quote.hash!==this.record.hash||quote!==this.quote||quote.quantity!==this.record.selections.length||quote.maximum!==maximumPayment(quote.price,quote.quantity,quote.buffer))throw Error('Review this mint again.');
    const status=await this.sync();if(status.state!=='ready')throw Error('Protection is not currently ready.');
    if(status.head.timestamp>quote.deadline)throw Error('The ten-minute quote deadline passed. Review again.');
    const opts={blockTag:status.head.number};
    if(await this.contract.salePhase(opts)!==PUBLIC_ACTIVE)throw Error('Public minting is temporarily unavailable.');
    if(await this.contract.mintPrice(quote.quantity,opts)>quote.maximum)throw Error('The price exceeds your maximum. Review a new quote. The cap has not been increased.');
    const c=await this.writable();
    // A simulation discloses the preimage to RPC operators even if it fails.
    this.save({state:'exposed',exposed:true});
    const args=[this.record.selections,this.record.salt,quote.maximum,quote.deadline],value=quote.maximum;
    try{
      await c.revealMint.staticCall(...args,{value});const gas=await c.revealMint.estimateGas(...args,{value});
      return await this.submit('reveal',c,nonce=>c.revealMint(...args,{value,nonce,gasLimit:gas*120n/100n}));
    }catch(error){
      const failure=Error('Your myFriend is now public. Your protection may still be valid. Review status and the new price before retrying.');
      failure.code=failureCode(error,this.contract.interface)||error.code;
      throw failure;
    }
  });}
}
