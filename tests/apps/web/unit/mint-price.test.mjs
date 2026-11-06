import test from 'node:test';
import assert from 'node:assert/strict';
import {mintActionAvailable,mintBatchPrice,formatMintETH,MINT_PRICE_STEP,saleMintPrice} from '../../../../apps/web/src/mint-price.js';
test('mint quotes follow chronological prices with exact wei and compact ETH display',()=>{
  for(const [minted,display] of [[0n,'0'],[1n,'0.0001'],[42n,'0.0042'],[99n,'0.0099'],[999n,'0.0999']])assert.equal(formatMintETH(mintBatchPrice(minted)),display);
  for(let minted=0n;minted<1000n;minted+=37n)for(let quantity=1n;quantity<=32n;quantity++){
    let expected=0n;for(let i=0n;i<quantity;i++)expected+=(minted+i)*MINT_PRICE_STEP;
    assert.equal(mintBatchPrice(minted,quantity),expected);
  }
  for(const [m,q] of [[-1n,1n],[0n,0n],[0n,33n],[1n<<48n,1n],[0,1n]])assert.throws(()=>mintBatchPrice(m,q),RangeError);
});
test('allowlist is always free; public pricing depends only on the public counter',()=>{
  assert.equal(saleMintPrice({salePhase:0},32n),0n);
  assert.equal(saleMintPrice({salePhase:1,publicMinted:100n},3n),0n);
  assert.equal(saleMintPrice({salePhase:2,publicMinted:0n}),0n);
  assert.equal(saleMintPrice({salePhase:3,publicMinted:10n}),1_000_000_000_000_000n);
  assert.equal(mintBatchPrice(0n,2n),100_000_000_000_000n);
  assert.equal(mintBatchPrice(0n,32n),49_600_000_000_000_000n);
});
test('a cached snapshot stays viewable offline but cannot advertise an available mint action',()=>{
  const current={snapshot:{salePhase:2},ready:true,busy:false,soldOut:false,taken:false,phaseClosed:false};
  assert.equal(mintActionAvailable(current),true);
  for(const changed of [{ready:false},{snapshot:null},{busy:true},{soldOut:true},{taken:true},{phaseClosed:true}]){
    assert.equal(mintActionAvailable({...current,...changed}),false);
  }
});
