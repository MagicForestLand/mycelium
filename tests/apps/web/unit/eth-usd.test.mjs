import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEthUsdQuote,formatMintUSD,fetchEthUsdQuote,ETH_USD_MAX_AGE} from '../../../../apps/web/src/eth-usd.js';
test('USD prices are approximate, fresh and independent from exact wei',()=>{
  const now=1800000000000,quote=parseEthUsdQuote({ethereum:{usd:2500,eur:2300,last_updated_at:now/1000}},now);
  assert.equal(quote.eur,2300);
  assert.equal(formatMintUSD(500000000000000n,quote,now),'(≈ $1.25)');
  assert.equal(formatMintUSD(0n,null,now),'($0.00)');
  assert.equal(formatMintUSD(1n,quote,now),'(<$0.01)');
  assert.equal(formatMintUSD(1n,quote,now+ETH_USD_MAX_AGE+1),'(USD unavailable)');
  assert.equal(formatMintUSD(1n,null,now),'(USD unavailable)');
  for(const body of [{},{ethereum:{usd:-1,last_updated_at:now/1000}},{ethereum:{usd:NaN,last_updated_at:now/1000}},{ethereum:{usd:2500,eur:-1,last_updated_at:now/1000}},{ethereum:{usd:2500,last_updated_at:1}},{ethereum:{usd:2500,last_updated_at:(now+120000)/1000}}])assert.throws(()=>parseEthUsdQuote(body,now));
});
test('quote fetch handles HTTP/malformed errors without inventing a rate',async()=>{
  await assert.rejects(()=>fetchEthUsdQuote(async()=>({ok:false})));
  await assert.rejects(()=>fetchEthUsdQuote(async()=>({ok:true,json:async()=>({})})));
  const quote=await fetchEthUsdQuote(async()=>({ok:true,json:async()=>({ethereum:{usd:2500,last_updated_at:Math.floor(Date.now()/1000)}})}));
  assert.equal(quote.usd,2500);
});
