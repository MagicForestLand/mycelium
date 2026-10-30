import {AbiCoder,keccak256,id,MaxUint256,toBeHex} from 'ethers';
export const TEST_SALT=toBeHex(1,32); // Test fixtures only; browser uses CSPRNG.
export function commitmentHash(chainId,collection,buyer,selections,salt=TEST_SALT){
  return keccak256(AbiCoder.defaultAbiCoder().encode(
    ['bytes32','uint256','address','address','uint256[6][]','bytes32'],
    [id('MyceliumFriends.PublicMint.v1'),chainId,collection,buyer,selections,salt]));
}
export async function matureCommit(token,local,selections,{buyer,salt=TEST_SALT,submit}={}){
  buyer??=await token.runner.getAddress();
  const hash=commitmentHash(BigInt(await local.request({method:'eth_chainId',params:[]})),token.target,buyer,selections,salt);
  const t=await token.commitments(buyer,hash);
  const head=await local.request({method:'eth_getBlockByNumber',params:['latest',false]});
  if(t===0n||BigInt(head.timestamp)>=t+86400n)await(await(submit?submit(hash):token.commit(hash))).wait();
  const timestamp=await token.commitments(buyer,hash);
  const latest=await local.request({method:'eth_getBlockByNumber',params:['latest',false]});
  const wait=timestamp+60n-BigInt(latest.timestamp);
  if(wait>0n){await local.request({method:'evm_increaseTime',params:[Number(wait)]});await local.request({method:'evm_mine',params:[]});}
  return hash;
}
// Explicit migration adapter for the existing ERC-721/metadata test scenarios.
// Every public mint performs real commit + time advance + reveal on the production contract.
// The dedicated protection suite tests raw selectors without this adapter.
export function withCommitReveal(token,local){
  return new Proxy(token,{get(target,key){
    if(key==='connect')return signer=>withCommitReveal(target.connect(signer),local);
    if(key!=='mint'&&key!=='mintBatch')return Reflect.get(target,key);
    const call=mode=>async(...args)=>{
      if(await target.salePhase()!==2n)return mode?target[key][mode](...args):target[key](...args);
      const selections=key==='mint'?[args.slice(0,6)]:args[0],opts=args[key==='mint'?6:1]||{};
      await matureCommit(target,local,selections);
      const inputs=[selections,TEST_SALT,opts.value??0n,MaxUint256,opts];
      const result=await(mode?target.revealMint[mode](...inputs):target.revealMint(...inputs));
      return mode==='staticCall'&&key==='mint'?result[0]:result;
    };
    return Object.assign(call(),{staticCall:call('staticCall'),estimateGas:call('estimateGas')});
  }});
}
export function withProtectedReceiver(receiver,token,local,kind='batch'){
  return new Proxy(receiver,{get(target,key){
    if(!['run','mint'].includes(key))return Reflect.get(target,key);
    const call=mode=>async(...args)=>{
      if(await token.salePhase()===2n){
        const selections=kind==='batch'?args[0]:[args.slice(kind==='nonreceiver'?1:0,kind==='nonreceiver'?7:6)];
        await matureCommit(token,local,selections,{buyer:target.target,submit:hash=>kind==='nonreceiver'?target.prepare(token.target,hash):target.prepare(hash)});
      }
      return mode?target[key][mode](...args):target[key](...args);
    };
    return Object.assign(call(),{staticCall:call('staticCall')});
  }});
}
