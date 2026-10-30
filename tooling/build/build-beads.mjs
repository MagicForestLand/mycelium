import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {applyArtwork} from '../lib/artwork.mjs';

const keys=['stem','cap','temperament','glasses','accessory','hobby'];
const catalog=JSON.parse(await readFile(new URL('../../collection/catalog/catalog.json',import.meta.url),'utf8'));
assert.equal(catalog.version,2,'Unsupported catalog source version');
const palette=structuredClone(catalog.palette);
const traits=structuredClone(catalog.traits);

assert.equal(catalog.stemOrder.length,traits.stem.length,'stemOrder must contain every stem ID exactly once');
assert.equal(new Set(catalog.stemOrder).size,traits.stem.length,'stemOrder must not contain duplicate stem IDs');
assert.deepEqual(new Set(catalog.stemOrder),new Set(traits.stem.map(item=>item.id)),'stemOrder must contain every stem ID exactly once');
const stemRank=new Map(catalog.stemOrder.map((id,index)=>[id,index]));
traits.stem.sort((a,b)=>stemRank.get(a.id)-stemRank.get(b.id));

assert.ok(palette.length<=256&&palette.every(color=>/^#[0-9a-f]{6}$/i.test(color)),'Invalid catalog palette');
for(const key of keys){
  assert.ok(Array.isArray(traits[key])&&traits[key].length<=256,'Invalid '+key+' catalog');
  assert.equal(new Set(traits[key].map(item=>item.id)).size,traits[key].length,'Duplicate '+key+' ID');
  for(const item of traits[key]){
    assert.match(item.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/,'Invalid trait ID');
    assert.match(item.data,/^(?:[a-f0-9]{8})*$/,'Invalid bead data for '+key+':'+item.id);
  }
}

const artwork=await applyArtwork(traits,palette,new URL('../../',import.meta.url).pathname);
const editions=catalog.editions.map(({selection,...edition})=>{
  const genotype=keys.map(key=>traits[key].findIndex(item=>item.id===selection[key]));
  assert.ok(genotype.every(index=>index>=0),'Edition references a missing trait: '+edition.slug);
  return {...edition,genotype};
});

await writeFile(new URL('../../collection/generated/bead-data.js',import.meta.url),
  '// Generated from collection/catalog/catalog.json and current designer SVGs by npm run build:beads. Do not hand-edit.\n'+
  `export const beadPalette = ${JSON.stringify(palette)};\n`+
  `export const beadTraits = ${JSON.stringify(traits)};\n`+
  `export const beadEditions = ${JSON.stringify(editions)};\n`);

console.log(`Loaded canonical catalog and applied ${artwork.updated} current designer updates.`);
for(const key of keys)console.log(`${key}: ${traits[key].length} traits, ${traits[key].reduce((n,item)=>n+item.data.length/2,0)} encoded bytes.`);
