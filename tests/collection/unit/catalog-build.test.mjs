import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {generateBanks} from '../../../tooling/lib/generate-banks.mjs';
const keys=['stem','cap','temperament','glasses','accessory','hobby'];
const catalog=counts=>Object.fromEntries(keys.map((key,i)=>[key,Array.from({length:counts[i]},(_,j)=>({id:`${key.toLowerCase()}-${j}`,name:`Trait ${j}`,description:`Description ${j}.`,data:'00000100'}))]));
test('every authored catalog source uses an existing public artwork path',()=>{
  const source=JSON.parse(readFileSync(new URL('../../../collection/catalog/catalog.json',import.meta.url),'utf8'));
  const edited=Object.values(source.traits).flatMap(items=>items.filter(item=>item.editedSource));
  assert.ok(edited.length>0);
  for(const item of edited){
    assert.ok(item.editedSource.startsWith('collection/artwork/'),`${item.id}: ${item.editedSource}`);
    assert.ok(existsSync(new URL('../../../'+item.editedSource,import.meta.url)),`${item.id}: missing ${item.editedSource}`);
  }
});
test('generated birth dimensions remain editable independently before deployment',()=>{
  for(const counts of [[23,100,22,23,13,32],[23,120,25,30,40,50],[1,1,1,1,1,1],[256,256,256,256,256,256]]){
    const output=generateBanks(catalog(counts),keys);
    assert.deepEqual(output.manifest.map(b=>b.count),counts);
    assert.match(output.schema,new RegExp(`MAX_SUPPLY = ${counts.reduce((a,b)=>a*b,1)};`));
    for(const bank of output.manifest)if(bank.pages.length)assert.equal(bank.pages.reduce((n,p)=>n+p.count,0),bank.count);
  }
});
test('unsafe or unrepresentable birth catalogs fail before deployment',()=>{
  for(const count of [0,257])assert.throws(()=>generateBanks(catalog([1,count,1,1,1,1]),keys));
  for(const name of ['bad"label','bad\\label','bad\nlabel']){const data=catalog([1,1,1,1,1,1]);data.cap[0].name=name;assert.throws(()=>generateBanks(data,keys));}
});
