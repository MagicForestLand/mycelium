import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateCollectionContribution,SPAIN_PARTIALLY_EXEMPT_TAX_RATE} from '../../../../apps/web/src/fundraising.js';

test('fundraising progress uses the post-tax remainder, not gross mint revenue',()=>{
  const estimate=estimateCollectionContribution(13.08);
  assert.equal(SPAIN_PARTIALLY_EXEMPT_TAX_RATE,0.25);
  assert.equal(estimate.grossEur,13.08);
  assert.equal(estimate.collectionCostsEur,0);
  assert.equal(estimate.taxableProfit,13.08);
  assert.equal(estimate.taxReserve,3.27);
  assert.equal(estimate.netContribution,9.81);
});

test('collection-funded costs reduce taxable profit and the bar never goes below zero',()=>{
  assert.deepEqual(estimateCollectionContribution(100,20),{
    grossEur:100,collectionCostsEur:20,taxableProfit:80,taxReserve:20,netContribution:60,taxRate:0.25
  });
  assert.deepEqual(estimateCollectionContribution(10,12),{
    grossEur:10,collectionCostsEur:12,taxableProfit:0,taxReserve:0,netContribution:0,taxRate:0.25
  });
});

test('displayed cents reconcile without overstating the fundraising remainder',()=>{
  assert.deepEqual(estimateCollectionContribution(13.086),{
    grossEur:13.08,collectionCostsEur:0,taxableProfit:13.08,taxReserve:3.27,netContribution:9.81,taxRate:0.25
  });
  assert.deepEqual(estimateCollectionContribution(13.099),{
    grossEur:13.09,collectionCostsEur:0,taxableProfit:13.09,taxReserve:3.28,netContribution:9.81,taxRate:0.25
  });
});

test('fundraising estimate rejects invalid money and tax inputs',()=>{
  for(const args of [[-1],[NaN],[1,-1],[1,0,-0.01],[1,0,1.01]])assert.throws(()=>estimateCollectionContribution(...args),RangeError);
});
