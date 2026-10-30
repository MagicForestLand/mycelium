import assert from 'node:assert/strict';
import {ContractFactory, MaxUint256} from 'ethers';

// Independent sum model; includes deterministic mixed successful/failed transitions.
export async function checkSettlement({compiled, signer, local}) {
  const deploy=async(name,args=[])=>{
    const a=compiled.contracts['tests/contracts/core/fixtures/SettlementFixtures.sol'][name];
    const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);
    await c.waitForDeployment();return c;
  };
  const h=await deploy('SettlementHarness'),w=await deploy('SettlementWallet',[h.target]);
  const step=100_000_000_000_000n, send=async p=>(await p).wait();
  let minted=0n,revenue=0n,refunds=0n,received=0n,transitions=0;
  const price=q=>Array.from({length:q},(_,i)=>(minted+BigInt(i))*step).reduce((a,b)=>a+b,0n);
  const invariant=async()=>{
    assert.equal(await h.minted(),minted);assert.equal(await h.revenue(),revenue);
    assert.equal(BigInt(await local.request({method:'eth_getBalance',params:[h.target,'latest']})),revenue);
    assert.equal(await w.refunds(),refunds);assert.equal(await w.received(),received);transitions++;
  };
  const run=async(q,n,mode=0,delta=0n,deadline=MaxUint256)=>{
    const actual=price(q),maximum=actual+step*BigInt(q)*BigInt(n);
    const fails=delta!==0n||n<0||deadline===0n||(n>0&&[1,3,4].includes(mode));
    const action=()=>send(w.run(q,maximum,deadline,mode,{value:maximum+delta,gasLimit:600_000}));
    if(fails)await assert.rejects(action,e=>e.receipt?.status===0);
    else {
      const receipt=await action();minted+=BigInt(q);revenue+=actual;
      const events=receipt.logs.filter(l=>l.address.toLowerCase()===h.target.toLowerCase()).map(l=>h.interface.parseLog(l));
      if(n>0){refunds++;received+=maximum-actual;assert.equal(events[0].args.amount,maximum-actual);}
      else assert.equal(events.length,0);
    }
    await invariant();
  };
  await run(1,10); // First single costs zero; entire buffer returned.
  for(const q of [1,2,32])for(const n of [0,1,3,10])await run(q,n);
  for(const mode of [1,2,3,4]){await run(2,1,mode);await run(1,0,mode);}
  await run(1,0,0,-1n);await run(1,0,0,1n);await run(1,-1);await run(1,0,0,0n,0n);
  let seed=0x6c627;
  for(let i=0;i<48;i++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    await run([1,2,32][seed%3],[0,1,3,10][(seed>>>4)%4],(seed>>>8)%4);
  }
  console.log(`PASS: capped settlement, rejecting/OOG/reentrant refunds, zero-call exact and ${transitions} stateful balance/counter transitions.`);
  return {transitions,seed:'0x6c627',minted:String(minted),revenue:String(revenue)};
}
