import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {traits,layerKeys,editions,renderSVG,OPEN,GROUP,CLOSE} from '../../../collection/source/art.js';
import {collectionCopy} from '../../../collection/source/editorial.js';
import {tokenMetadata} from '../../../collection/source/metadata.js';
import {generateBanks} from '../../../tooling/lib/generate-banks.mjs';
import {collectionMetadata} from '../../../tooling/lib/generate-metadata.mjs';
const readJSON=file=>JSON.parse(readFileSync(new URL('../../../'+file,import.meta.url),'utf8'));
test('the canonical catalog is internally complete and renders every trait and composition',()=>{
  const ids=[];
  for(const key of layerKeys){
    assert.ok(traits[key].length>0);
    for(const t of traits[key]){
      ids.push(key+':'+t.id);
      assert.match(t.id,/^[a-z0-9-]+$/);
      assert.match(OPEN+GROUP+t.svg+CLOSE,/^<svg[\s\S]*<\/svg>$/);
      assert.ok(t.data.length>0||t.id==='none');
    }
  }
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(ids.length,244);
  for(const e of editions){
    assert.match(e.slug,/^[a-z0-9-]+$/);
    assert.equal(e.genotype.length,layerKeys.length);
    for(const [i,index] of e.genotype.entries())assert.ok(index>=0&&index<traits[layerKeys[i]].length);
    assert.match(renderSVG(e.genotype),/^<svg[\s\S]*<\/svg>$/);
  }
  assert.equal(editions.length,29);
});

test('every authored trait appears in standard metadata',()=>{
  const source=readJSON('collection/catalog/catalog.json');
  for(const [layer,key] of layerKeys.entries()){
    assert.equal(new Set(traits[key].map(t=>t.name)).size,traits[key].length,'Duplicate names in '+key);
    for(const [index,t]of traits[key].entries()){
      const original=source.traits[key].find(item=>item.id===t.id);
      assert.equal(t.name,original.name);assert.equal(t.description,original.description);
      assert.ok(t.description.length>=30&&t.description.length<=240);
      const g=[0,0,0,0,0,0];g[layer]=index;
      const tokenId=layer*256+index+1,metadata=tokenMetadata(g,{tokenId});
      assert.equal(metadata.name,'Mycelium Friend #'+tokenId);
      assert.equal(metadata.external_url,collectionCopy.projectURL);
      assert.ok(metadata.description.includes(t.name+': '+t.description));
      assert.equal(metadata.attributes[layer].value,t.name);
      assert.doesNotThrow(()=>JSON.parse(JSON.stringify(metadata)));
    }
  }
  assert.deepEqual(traits.stem.map(t=>t.id),source.stemOrder);
  for(const e of editions)assert.ok(e.description.length>20);
});

test('unsafe or missing stories cannot be compiled into concatenated JSON',()=>{
  for(const description of [undefined,'','bad"quote','bad\\escape','bad\nline','x'.repeat(241)]){
    const bad=Object.fromEntries(layerKeys.map(key=>[key,traits[key].map(t=>({...t}))]));
    bad.cap[0].description=description;
    assert.throws(()=>generateBanks(bad,layerKeys),/unsafe or missing description/);
  }
});

test('publication exports use sequential sample token IDs and embed all token and collection artwork',()=>{
  for(const [i,e]of editions.entries())assert.deepEqual(readJSON('output/metadata/'+String(i+1).padStart(2,'0')+'-'+e.slug+'.json'),tokenMetadata(e.genotype,{tokenId:i+1}));
  const collection=collectionMetadata();assert.deepEqual(readJSON('output/collection-metadata.json'),collection);
  for(const key of ['image','banner_image']){
    assert.ok(collection[key].startsWith('data:image/svg+xml;base64,'));
    const svg=Buffer.from(collection[key].split(',')[1],'base64').toString();
    assert.match(svg,/^<svg /);
    assert.doesNotMatch(svg,/<script|<foreignObject|(?:href|src)=["']https?:|url\(https?:/i);
  }
});
