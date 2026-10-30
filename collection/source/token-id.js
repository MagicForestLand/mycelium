// Zero-based mixed-radix genotype indexes for catalog tools. ERC-721 token IDs are sequential from one.
import {beadTraits} from '../generated/bead-data.js';
export const TRAIT_COUNTS = Object.freeze(['stem','cap','temperament','glasses','accessory','hobby'].map(key=>beadTraits[key].length));
export const MAX_SUPPLY = TRAIT_COUNTS.reduce((total,count)=>total*count,1);

function boundedInteger(value, limit) {
  if (typeof value === 'bigint') {
    if (value < 0n || value >= BigInt(limit)) throw new RangeError('Index out of range.');
    return Number(value);
  }
  if (!Number.isSafeInteger(value) || value < 0 || value >= limit) {
    throw new RangeError('Index out of range.');
  }
  return value;
}

export function genotypeIndexForTraits(stem, cap, temperament, glasses, accessory, hobby) {
  const values = [stem, cap, temperament, glasses, accessory, hobby].map((v, i) => boundedInteger(v, TRAIT_COUNTS[i]));
  return values.reduceRight((id,value,i)=>id*TRAIT_COUNTS[i]+value,0);
}

export function traitsForGenotypeIndex(genotypeIndex) {
  let remaining = boundedInteger(genotypeIndex, MAX_SUPPLY);
  return TRAIT_COUNTS.map(count => {
    const index = remaining % count;
    remaining = Math.floor(remaining / count);
    return index;
  });
}
