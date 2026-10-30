// Display-only exchange rate. ETH/wei remains authoritative for payment.
// One early request supplies both currencies used by the interface. Reusing it
// keeps the About view from starting a second third-party request for ETH/EUR.
export const ETH_USD_URL='https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd%2Ceur&include_last_updated_at=true';
export const ETH_USD_MAX_AGE=15*60*1000;
export function parseEthUsdQuote(body,now=Date.now()){
  const usd=body?.ethereum?.usd,eur=body?.ethereum?.eur,updatedAt=body?.ethereum?.last_updated_at*1000;
  if(typeof usd!=='number'||!Number.isFinite(usd)||usd<=0||usd>1e9||!Number.isFinite(updatedAt)||updatedAt>now+60_000||now-updatedAt>ETH_USD_MAX_AGE)throw new Error('Invalid or stale ETH/USD quote');
  if(eur!==undefined&&(typeof eur!=='number'||!Number.isFinite(eur)||eur<=0||eur>1e9))throw new Error('Invalid ETH/EUR quote');
  return {usd,...(eur===undefined?{}:{eur}),updatedAt,source:'CoinGecko'};
}
export function formatMintUSD(wei,quote,now=Date.now()){
  if(typeof wei!=='bigint'||wei<0n)throw new RangeError('Invalid ETH amount');
  if(wei===0n)return '($0.00)';
  if(!quote||!Number.isFinite(quote.usd)||quote.usd<=0||!Number.isFinite(quote.updatedAt)||now-quote.updatedAt>ETH_USD_MAX_AGE||quote.updatedAt>now+60_000)return '(USD unavailable)';
  const value=Number(wei)/1e18*quote.usd;
  if(!Number.isFinite(value))return '(USD unavailable)';
  if(value<0.01)return '(<$0.01)';
  return '(≈ '+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(value)+')';
}
export async function fetchEthUsdQuote(fetcher=globalThis.fetch){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
    const response=await fetcher(ETH_USD_URL,{signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
    if(!response.ok)throw new Error('ETH/USD temporarily unavailable');
    return parseEthUsdQuote(await response.json());
  }finally{clearTimeout(timer);}
}
