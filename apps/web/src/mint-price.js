// Chronological PUBLIC mints only; allowlist mints never advance the public curve.
export const MINT_PRICE_STEP = 100_000_000_000_000n;
export function mintBatchPrice(minted, quantity=1n) {
  if(typeof minted!=='bigint'||typeof quantity!=='bigint'||minted<0n||quantity<1n||quantity>32n||minted+quantity>(1n<<48n))throw new RangeError('Invalid mint quote.');
  return MINT_PRICE_STEP*(quantity*minted+quantity*(quantity-1n)/2n);
}
export function formatMintETH(wei) {
  if(typeof wei!=='bigint'||wei<0n)throw new RangeError('Invalid ETH amount.');
  const whole=wei/10n**18n,fraction=(wei%10n**18n).toString().padStart(18,'0').replace(/0+$/,'');
  return fraction?whole+'.'+fraction:String(whole);
}
export function saleMintPrice({salePhase,publicMinted=0n},quantity=1n){
  if(!Number.isInteger(salePhase)||salePhase<0||salePhase>3||typeof quantity!=='bigint'||quantity<1n||quantity>32n)throw new RangeError('Invalid sale quote.');
  return salePhase>=2?mintBatchPrice(publicMinted,quantity):0n;
}
export function mintActionAvailable({snapshot,ready,busy,soldOut,taken,phaseClosed}){
  return Boolean(snapshot)&&ready===true&&!busy&&!soldOut&&!taken&&!phaseClosed;
}
