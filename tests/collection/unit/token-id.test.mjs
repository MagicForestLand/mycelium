import test from 'node:test';
import assert from 'node:assert/strict';
import {TRAIT_COUNTS, MAX_SUPPLY, genotypeIndexForTraits, traitsForGenotypeIndex} from '../../../collection/source/token-id.js';
import {layerKeys, traits, genotypeFromNumber} from '../../../collection/source/art.js';

test('sampled genotype indices are reversible and match mixed-radix enumeration', () => {
  assert.deepEqual(TRAIT_COUNTS, layerKeys.map(key => traits[key].length));
  const ids=new Set([0,1,MAX_SUPPLY-2,MAX_SUPPLY-1]);
  for(let id=0;id<100000;id++)ids.add(id);
  for(let id=0;id<MAX_SUPPLY;id+=7919)ids.add(id);
  for (const id of ids) {
    const values = traitsForGenotypeIndex(id);
    assert.deepEqual(values, genotypeFromNumber(id));
    assert.equal(genotypeIndexForTraits(...values), id);
    if(id%10000===0){assert.equal(genotypeIndexForTraits(...values.map(BigInt)),id);assert.deepEqual(traitsForGenotypeIndex(BigInt(id)),values);}
  }
  assert.equal(genotypeIndexForTraits(0, 0, 0, 0, 0, 0), 0);
  assert.equal(genotypeIndexForTraits(...TRAIT_COUNTS.map(n=>n-1)), MAX_SUPPLY-1);
});

test('frontend helpers reject every invalid boundary and malformed input', () => {
  for (let layer = 0; layer < TRAIT_COUNTS.length; layer++) {
    for (const invalid of [-1, -1n, TRAIT_COUNTS[layer], BigInt(TRAIT_COUNTS[layer]), 256, 2n ** 256n - 1n, NaN, Infinity, 0.5, '0', null, undefined]) {
      const values = TRAIT_COUNTS.map(()=>0);
      values[layer] = invalid;
      assert.throws(() => genotypeIndexForTraits(...values), RangeError);
    }
  }
  for (const invalid of [-1, -1n, MAX_SUPPLY, BigInt(MAX_SUPPLY), 2n ** 256n - 1n, NaN, Infinity, 0.5, '0', null, undefined]) {
    assert.throws(() => traitsForGenotypeIndex(invalid), RangeError);
  }
});
