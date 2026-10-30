export const SPAIN_PARTIALLY_EXEMPT_TAX_RATE = 0.25;

export function estimateCollectionContribution(grossEur, collectionCostsEur=0, taxRate=SPAIN_PARTIALLY_EXEMPT_TAX_RATE) {
  if(!Number.isFinite(grossEur)||grossEur<0)throw new RangeError('Invalid gross proceeds.');
  if(!Number.isFinite(collectionCostsEur)||collectionCostsEur<0)throw new RangeError('Invalid collection costs.');
  if(!Number.isFinite(taxRate)||taxRate<0||taxRate>1)throw new RangeError('Invalid tax rate.');
  const grossCents=Math.floor(grossEur*100+1e-9);
  const costCents=Math.ceil(collectionCostsEur*100-1e-9)||0;
  const taxableCents=Math.max(0,grossCents-costCents);
  const taxCents=Math.ceil(taxableCents*taxRate-1e-9)||0;
  const netCents=Math.max(0,grossCents-costCents-taxCents);
  return {
    grossEur:grossCents/100,
    collectionCostsEur:costCents/100,
    taxableProfit:taxableCents/100,
    taxReserve:taxCents/100,
    netContribution:netCents/100,
    taxRate
  };
}
