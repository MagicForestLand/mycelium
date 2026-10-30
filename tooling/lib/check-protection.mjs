import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory,MaxUint256,ZeroAddress,ZeroHash,toBeHex} from 'ethers';
import {commitmentHash,TEST_SALT} from './protected-test-client.mjs';
import {traitsForGenotypeIndex,MAX_SUPPLY,TRAIT_COUNTS} from '../../collection/source/token-id.js';

export async function checkProtection({compiled,provider,signer,genotypeDescriptor,phenotype,local}){
  const a=await signer.getAddress(),bSigner=await provider.getSigner(1),b=await bSigner.getAddress();
  const send=async p=>(await p).wait(),checks=[],gas={};
  const mark=s=>{checks.push(s);console.log('PASS: '+s);};
  const deploy=async(file,name,args=[],opts={})=>{const x=compiled.contracts[file][name];const c=await new ContractFactory(x.abi,x.evm.bytecode.object,signer).deploy(...args,opts);await c.waitForDeployment();return c;};
  const fresh=cap=>deploy('contracts/core/MyceliumFriends.sol','MyceliumFriends',[genotypeDescriptor.target,phenotype.target,a,a,cap,a]);
  const step=100_000_000_000_000n,sel=n=>traitsForGenotypeIndex(n),chain=BigInt(await local.request({method:'eth_chainId',params:[]}));
  const head=async()=>BigInt((await local.request({method:'eth_getBlockByNumber',params:['latest',false]})).timestamp);
  const at=async t=>{await local.request({method:'evm_setTime',params:[Number(t)*1000]});await local.request({method:'evm_mine',params:[]});};
  const balance=async address=>BigInt(await local.request({method:'eth_getBalance',params:[address,'latest']}));
  const error=async(fn,name,c)=>assert.rejects(fn,e=>{assert.equal(c.interface.parseError(e.data)?.name,name);return true;});
  const token=await fresh(128),s=[sel(100)],hash=commitmentHash(chain,token.target,a,s);
  await error(()=>token.commit.staticCall(hash),'PublicSaleNotOpen',token);
  await error(()=>token.revealMint.staticCall(s,TEST_SALT,0,MaxUint256),'PublicSaleNotOpen',token);
  await error(()=>token.mint.staticCall(...sel(0)),'InvalidSalePhase',token);
  await send(token.setAllowlistAllocations([a,b],[1,1]));
  await error(()=>token.mint.staticCall(...sel(0)),'InvalidSalePhase',token);
  await send(token.startAllowlistSale());assert.equal(await token.salePhase(),1n);
  await send(token.mint(...sel(0)));
  await send(token.openPublicSale());assert.equal(await token.salePhase(),2n);
  for(const buyer of [token,token.connect(bSigner)]){
    await error(()=>buyer.mint.staticCall(...sel(1)),'InvalidSalePhase',token);
    await error(()=>buyer.mintBatch.staticCall([sel(1)]),'InvalidSalePhase',token);
  }
  await error(()=>token.commit.staticCall(ZeroHash),'InvalidCommitment',token);
  await error(()=>token.makeCommitment(a,s,ZeroHash),'InvalidCommitment',token);
  await error(()=>token.revealMint.staticCall(s,TEST_SALT,0,MaxUint256),'CommitmentNotReady',token);
  assert.equal(await token.makeCommitment(a,s,TEST_SALT),hash);
  const r=await send(token.commit(hash));gas.commit=r.gasUsed.toString();const t=await token.commitments(a,hash);
  await error(()=>token.revealMint.staticCall(s,TEST_SALT,0,MaxUint256),'CommitmentNotReady',token);
  await send(token.connect(bSigner).commit(hash));assert.equal(await token.commitments(a,hash),t);
  await error(()=>token.connect(bSigner).revealMint.staticCall(s,TEST_SALT,0,MaxUint256),'CommitmentNotReady',token);
  await error(()=>token.commit.staticCall(hash),'CommitmentActive',token);
  await at(t+59n);await error(()=>token.revealMint.staticCall(s,TEST_SALT,0,MaxUint256),'CommitmentNotReady',token);
  await at(t+60n);assert.equal((await token.revealMint.staticCall(s,TEST_SALT,0,MaxUint256))[0],2n);
  await error(async()=>token.revealMint.staticCall(s,TEST_SALT,0,(await head())-1n),'MintDeadlineExpired',token);
  assert.equal((await token.revealMint.staticCall(s,TEST_SALT,0,await head()))[0],2n);
  await error(()=>token.revealMint.staticCall(s,TEST_SALT,1,MaxUint256),'IncorrectPayment',token);
  const receipt=await send(token.revealMint(s,TEST_SALT,step*10n,MaxUint256,{value:step*10n}));gas.firstReveal=receipt.gasUsed.toString();
  const logs=receipt.logs.map(l=>token.interface.parseLog(l));
  assert.deepEqual(logs.map(l=>l.name),['CommitmentConsumed','Minted','GenotypeAssigned','Transfer','MintRefunded']);
  assert.equal(logs[1].args.paid,0n);assert.equal(logs.at(-1).args.amount,step*10n);
  assert.equal(await token.commitments(a,hash),0n);assert.equal(await balance(token.target),0n);
  await error(()=>token.revealMint.staticCall(s,TEST_SALT,0,MaxUint256),'CommitmentNotReady',token);
  await send(token.commit(hash));await at((await token.commitments(a,hash))+60n);
  await error(()=>token.revealMint.staticCall(s,TEST_SALT,step,MaxUint256,{value:step}),'CombinationAlreadyMinted',token);
  mark('Public-only commitment, allowlist route closure, copied hash isolation, exact minimum/deadline boundaries, actual-paid events and consumed replay.');

  const paused=await fresh(4),pv=[sel(106)],ph=commitmentHash(chain,paused.target,a,pv);
  assert.equal(await paused.salePhase(),0n);
  await send(paused.startAllowlistSale());await send(paused.openPublicSale());
  await send(paused.commit(ph));await at((await paused.commitments(a,ph))+60n);
  const pausedPrice=await paused.mintPrice(1),pausedPublicMinted=await paused.publicMinted();
  await send(paused.pausePublicSale());assert.equal(await paused.salePhase(),3n);
  await error(()=>paused.commit.staticCall(commitmentHash(chain,paused.target,a,[sel(107)])),'PublicSaleNotOpen',paused);
  await error(()=>paused.revealMint.staticCall(pv,TEST_SALT,pausedPrice,MaxUint256,{value:pausedPrice}),'PublicSaleNotOpen',paused);
  assert.equal(await paused.publicMinted(),pausedPublicMinted);assert.equal(await paused.mintPrice(1),pausedPrice);
  await send(paused.resumePublicSale());assert.equal(await paused.salePhase(),2n);
  await send(paused.revealMint(pv,TEST_SALT,pausedPrice,MaxUint256,{value:pausedPrice}));
  assert.equal(await paused.publicMinted(),pausedPublicMinted+1n);
  mark('Public pause blocks commit/reveal without reopening allowlist or resetting the pricing position; resume continues the same commitment flow.');

  const exp=[sel(101)],h=commitmentHash(chain,token.target,a,exp);await send(token.commit(h));const e=await token.commitments(a,h);
  await at(e+86399n);await token.revealMint.staticCall(exp,TEST_SALT,step,MaxUint256,{value:step});
  await at(e+86400n);await error(()=>token.revealMint.staticCall(exp,TEST_SALT,step,MaxUint256,{value:step}),'CommitmentExpired',token);
  await send(token.commit(h));const next=await token.commitments(a,h);assert.ok(next>=e+86400n);
  await error(()=>token.revealMint.staticCall(exp,TEST_SALT,step,MaxUint256,{value:step}),'CommitmentNotReady',token);
  await at(next+60n);
  for(const selections of [[],Array(33).fill(sel(102)),[sel(102),sel(102)],[[256,0,0,0,0,0]]]){
    const bad=commitmentHash(chain,token.target,a,selections);await send(token.commit(bad));await at((await token.commitments(a,bad))+60n);
    await assert.rejects(()=>token.revealMint.staticCall(selections,TEST_SALT,step,MaxUint256,{value:step}));
    assert.notEqual(await token.commitments(a,bad),0n);
  }
  const vectors=[sel(103),sel(104)],hv=commitmentHash(chain,token.target,a,vectors);await send(token.commit(hv));await at((await token.commitments(a,hv))+60n);
  for(const [v,salt] of [[vectors.slice().reverse(),TEST_SALT],[vectors.slice(0,1),TEST_SALT],[vectors,toBeHex(2,32)]])
    await error(()=>token.revealMint.staticCall(v,salt,3n*step,MaxUint256,{value:3n*step}),'CommitmentNotReady',token);
  const clone=await fresh(4);await send(clone.startAllowlistSale());await send(clone.openPublicSale());await send(clone.commit(hv));await at((await clone.commitments(a,hv))+60n);
  await error(()=>clone.revealMint.staticCall(vectors,TEST_SALT,step,MaxUint256,{value:step}),'CommitmentNotReady',clone);
  mark('Expiry/recommit boundary, invalid quantities/traits, ordered batch/salt binding and cross-contract replay rejection.');
  const otherLocal=ganache.provider({logging:{quiet:true},chain:{chainId:Number(chain)+1,hardfork:'shanghai'}});
  try {
    const otherProvider=new BrowserProvider(otherLocal,undefined,{cacheTimeout:-1});otherProvider.pollingInterval=10;
    const otherSigner=await otherProvider.getSigner(),otherBuyer=await otherSigner.getAddress();
    const otherDeploy=async(file,name,args)=>{const x=compiled.contracts[file][name];const c=await new ContractFactory(x.abi,x.evm.bytecode.object,otherSigner).deploy(...args);await c.waitForDeployment();return c;};
    const desc=await otherDeploy('tests/contracts/core/fixtures/MintFixtures.sol','GenotypeCountsMock',[TRAIT_COUNTS,MAX_SUPPLY]);
    const renderer=await otherDeploy('contracts/core/PhenotypeRenderer.sol','PhenotypeRenderer',[desc.target]);
    const other=await otherDeploy('contracts/core/MyceliumFriends.sol','MyceliumFriends',[desc.target,renderer.target,otherBuyer,otherBuyer,4,otherBuyer]);
    const wrongChain=commitmentHash(chain,other.target,otherBuyer,vectors),rightChain=commitmentHash(chain+1n,other.target,otherBuyer,vectors);
    assert.equal(await other.makeCommitment(otherBuyer,vectors,TEST_SALT),rightChain);assert.notEqual(wrongChain,rightChain);
    await send(other.startAllowlistSale());await send(other.openPublicSale());await send(other.commit(wrongChain));
    await otherLocal.request({method:'evm_increaseTime',params:[60]});await otherLocal.request({method:'evm_mine',params:[]});
    await error(()=>other.revealMint.staticCall(vectors,TEST_SALT,step,MaxUint256,{value:step}),'CommitmentNotReady',other);
    await send(other.commit(rightChain));await otherLocal.request({method:'evm_increaseTime',params:[60]});await otherLocal.request({method:'evm_mine',params:[]});
    await send(other.revealMint(vectors,TEST_SALT,step,MaxUint256,{value:step}));
  } finally { await otherLocal.disconnect(); }
  mark('A second local chain rejects a transplanted chainId commitment and accepts its own ABI-encoded domain.');


  const wallet=await deploy('tests/contracts/core/fixtures/ProtectionFixtures.sol','ProtectionWallet',[token.target]);
  const exec=(name,args,value=0n,gasLimit=2_000_000)=>wallet.execute(token.interface.encodeFunctionData(name,args),{value,gasLimit});
  let index=200;
  for(const [mode,failAt,buffer,ok] of [[0,0,1,true],[1,0,1,false],[1,0,0,true],[2,0,1,true],[3,0,1,false],[4,0,1,false],[0,2,1,false]]){
    const v=[sel(index++),sel(index++)],hw=commitmentHash(chain,token.target,wallet.target,v);
    await send(wallet.configure(mode,failAt,mode===2?b:ZeroAddress));await send(exec('commit',[hw]));await at((await token.commitments(wallet.target,hw))+60n);
    const actual=await token.mintPrice(2),maximum=actual+step*2n*BigInt(buffer),before=await token.totalMinted(),funds=await balance(token.target),age=await token.commitments(wallet.target,hw);
    const action=()=>send(exec('revealMint',[v,TEST_SALT,maximum,MaxUint256],maximum));
    if(ok){const rr=await action();gas['walletMode'+mode+'Buffer'+buffer]=rr.gasUsed.toString();assert.equal(await token.commitments(wallet.target,hw),0n);assert.equal(await token.totalMinted(),before+2n);assert.equal(await balance(token.target),funds+actual);if(mode===2)assert.equal(await token.ownerOf(before+1n),b);}
    else {await assert.rejects(action,e=>e.receipt?.status===0);assert.equal(await token.totalMinted(),before);assert.equal(await balance(token.target),funds);assert.equal(await token.commitments(wallet.target,hw),age);for(const x of v)assert.equal(await token.tokenForTraits(...x),0n);}
  }
  mark('Contract-wallet refunds, no-call Exact, batch receiver rollback, caught/propagated/OOG reentry and callback NFT forwarding.');

  // Independent state machine: random funded caps/failures, withdrawals, forced ETH and sequential DNA indexes.
  const model=await fresh(2048);await send(model.setAllowlistAllocations([a],[2]));
  await send(model.startAllowlistSale());await send(model.mintBatch([sel(0),sel(1)]));await send(model.openPublicSale());
  let minted=0n,revenue=0n,withdrawn=0n,forced=11n,seed=0x76c6,transitions=0;const assigned=[[sel(0),1n],[sel(1),2n]];
  await deploy('tests/contracts/core/fixtures/ProtectionFixtures.sol','ForcedETH',[model.target],{value:forced});
  for(let i=0;i<40;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const q=[1,2,32][seed%3],v=Array.from({length:q},(_,j)=>sel(1000+i*32+j)),salt=toBeHex(i+2,32);
    const hm=commitmentHash(chain,model.target,a,v,salt);await send(model.commit(hm));await at((await model.commitments(a,hm))+60n);
    const actual=Array.from({length:q},(_,j)=>(minted+BigInt(j))*step).reduce((a,b)=>a+b,0n);
    const fails=i%5===4,maximum=fails?actual-1n:actual+BigInt((seed>>>4)%11)*BigInt(q)*step;
    const action=()=>send(model.revealMint(v,salt,maximum,MaxUint256,{value:maximum,gasLimit:8_000_000}));
    if(fails){await assert.rejects(action,e=>e.receipt?.status===0);assert.notEqual(await model.commitments(a,hm),0n);}
    else{const rr=await action();gas['batch'+q]=rr.gasUsed.toString();const paid=rr.logs.map(l=>model.interface.parseLog(l)).find(l=>l.name==='Minted').args.paid;assert.equal(paid,actual);v.forEach((x,j)=>assigned.push([x,minted+3n+BigInt(j)]));minted+=BigInt(q);revenue+=actual;assert.equal(await model.commitments(a,hm),0n);}
    if(i%7===6){const amount=await balance(model.target);await send(model.connect(bSigner).withdraw());withdrawn+=amount;}
    assert.equal(await model.publicMinted(),minted);assert.equal(await model.allowlistMinted(),2n);assert.equal(await model.totalMinted(),minted+2n);assert.equal(await model.balanceOf(a),minted+2n);
    assert.equal(await balance(model.target)+withdrawn,revenue+forced);
    for(const [x,id] of assigned.slice(-32)){assert.equal(await model.tokenForTraits(...x),id);assert.equal(await model.ownerOf(id),a);}
    transitions++;
  }
  mark(`${transitions} seeded lifecycle/price/cap transitions preserve counters, unique sequential DNA and ETH conservation including forced ETH/withdrawal.`);
  // Expected limitation: a copied selection can win once its own commitment matures.
  const race=await fresh(4),v=[sel(MAX_SUPPLY-1)];await send(race.startAllowlistSale());await send(race.openPublicSale());
  const ha=commitmentHash(chain,race.target,a,v),hb=commitmentHash(chain,race.target,b,v);await send(race.commit(ha));await at((await race.commitments(a,ha))+60n);
  await send(race.connect(bSigner).commit(hb));await error(()=>race.connect(bSigner).revealMint.staticCall(v,TEST_SALT,0,MaxUint256),'CommitmentNotReady',race);
  await at((await race.commitments(b,hb))+60n);await send(race.connect(bSigner).revealMint(v,TEST_SALT,0,MaxUint256));
  await error(()=>race.revealMint.staticCall(v,TEST_SALT,0,MaxUint256),'CombinationAlreadyMinted',race);
  mark('Delayed original reveal can lose to a newly matured copy: accepted rolling-commitment limitation reproduced.');
  return {checks,gas,statefulTransitions:transitions,seed:'0x76c6'};
}
