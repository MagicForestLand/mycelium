import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {traits,layerKeys,renderLayerKeys,brushCapOffsets,compositionOffsetX,renderTraitSVG,editions,combinations,renderSVG,packGenotype,unpackGenotype,genotypeFromNumber,attributes,decodeBeads,beadPalette,OPEN,GROUP,CLOSE} from '../../../collection/source/art.js';

test('six-byte packing preserves boundaries and 10000 deterministic combinations',()=>{
  const packed=new Set();
  for(let sample=0;sample<10000;sample++){
    const n=sample<32?layerKeys.reduce((v,k,i)=>v+(sample&(1<<i)?traits[k].length-1:0)*layerKeys.slice(0,i).reduce((a,j)=>a*traits[j].length,1),0):(sample*7919)%combinations;
    const genotype=genotypeFromNumber(n),value=packGenotype(genotype);
    assert.deepEqual(unpackGenotype(value),genotype);
    packed.add(value.toString());
  }
  assert.ok(packed.size>9900);
});
test('invalid, truncated and overflowing genotypes are rejected',()=>{
  for(const bad of [[],[0,0,0],[0,0,0,0],[0,0,0,0,0],[0,0,0,0,0,0,0],[-1,0,0,0,0,0],[0,0,0,999,0,0],[1.5,0,0,0,0,0],['0',0,0,0,0,0]]) assert.throws(()=>renderSVG(bad),RangeError);
  for(let i=0;i<layerKeys.length;i++){const genotype=layerKeys.map(()=>0);genotype[i]=traits[layerKeys[i]].length;assert.throws(()=>packGenotype(genotype),RangeError);}
  for(const bad of [-1n,1n<<48n])assert.throws(()=>unpackGenotype(bad),RangeError);
  assert.throws(()=>genotypeFromNumber(combinations),RangeError);
});
test('all trait fragments use only self-contained vector primitives',()=>{
  const allowed=new Set(['path','circle','ellipse','g']);
  for(const key of layerKeys)for(const item of traits[key]){
    assert.doesNotMatch(item.svg,/(?:href|url\((?!#bs-p\d+\))|<image|<text|<script|<foreignObject|<filter|onload|data:)/i,`${key}/${item.id}`);
    for(const tag of item.svg.matchAll(/<\/?([a-zA-Z]+)/g))assert.ok(allowed.has(tag[1]),tag[1]);
    assert.doesNotMatch(item.name,/["\\\x00-\x1f]/,'Bank labels must be JSON-safe ASCII.');
    assert.match(item.name,/^[\x20-\x7e]*$/);
  }
});
test('encoded beads stay on-grid without duplicate cells and resolve local SVG patterns',()=>{
  const definitionIDs=new Set([...GROUP.matchAll(/ id="([^"]+)"/g)].map(m=>m[1]));
  for(const key of layerKeys)for(const item of traits[key]){
    const bytes=Buffer.from(item.data,'hex'),cells=new Set();
    assert.equal(bytes.length%4,0);
    for(let i=0;i<bytes.length;i+=4){
      const [x,y,count,color]=bytes.subarray(i,i+4);
      assert.ok(y<80&&count>0&&x+count<=80&&color<beadPalette.length);
      for(let n=0;n<count;n++){const key=`${x+n},${y}`;assert.ok(!cells.has(key));cells.add(key);}
    }
    assert.equal(cells.size,item.beads);
    for(const ref of item.svg.matchAll(/url\(#([^)]*)\)/g))assert.ok(definitionIDs.has(ref[1]));
  }
  for(const bad of ['a','00000000','50000100','004f5100','000001ff'])assert.throws(()=>decodeBeads(bad),RangeError);
});
test('exported editions match renderer byte for byte, with embedded SVG metadata',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../../../output/manifest.json',import.meta.url)));
  for(const [i,item] of manifest.editions.entries()){
    const expected=renderSVG(editions[i].genotype);
    const actual=await readFile(new URL(`../../../output/${item.file}`,import.meta.url),'utf8');
    assert.equal(actual,expected);
    assert.equal(Buffer.byteLength(actual),item.bytes);
    const metadata=JSON.parse(await readFile(new URL(`../../../output/metadata/${item.file.split('/')[1].replace('.svg','.json')}`,import.meta.url)));
    assert.equal(Buffer.from(metadata.image.split(',')[1],'base64').toString(),expected);
    assert.deepEqual(metadata.attributes,attributes(item.genotype));
  }
});
test('canonical exports are transparent and the studio background is fixed to black',()=>{
  assert.deepEqual(renderLayerKeys,['stem','temperament','glasses','cap','accessory','hobby']);
  for(const item of editions){
    const expected=OPEN+GROUP+renderLayerKeys.map(k=>renderTraitSVG(item.genotype,k)).join('')+CLOSE;
    assert.equal(renderSVG(item.genotype),expected);
    assert.doesNotMatch(renderSVG(item.genotype),/M0 0h400v400H0z/);
    assert.match(renderSVG(item.genotype,{background:0}),/<path fill="#000000" d="M0 0h400v400H0z"\/>/);
  }
});

test('Paint It Green rests on Chanterelle and Hand of God only',()=>{
  assert.equal(traits.accessory[brushCapOffsets.accessory].id,'painters-plume');
  assert.equal(traits.cap[brushCapOffsets.chanterelle.cap].id,'chanterelle');
  assert.equal(traits.cap[brushCapOffsets.sleepyHand.cap].id,'sleepy-hand');
  const cells=trait=>{
    const result=new Map();
    for(let i=0;i<trait.data.length;i+=8){
      const x=parseInt(trait.data.slice(i,i+2),16),y=parseInt(trait.data.slice(i+2,i+4),16),count=parseInt(trait.data.slice(i+4,i+6),16),color=parseInt(trait.data.slice(i+6,i+8),16);
      for(let dx=0;dx<count;dx++)result.set(`${x+dx},${y}`,color);
    }
    return result;
  };
  const brush=cells(traits.accessory[brushCapOffsets.accessory]);
  const darkBase=[...brush].filter(([key,color])=>{const y=Number(key.split(',')[1]);return color===0&&y>=25&&y<=31;}).map(([key])=>key.split(',').map(Number));
  const woodenHandle=[...brush].filter(([key,color])=>{const y=Number(key.split(',')[1]);return [2,11,18].includes(color)&&y<=29;}).map(([key])=>key.split(',').map(Number));
  assert.equal(darkBase.length,17);
  for(const rule of [brushCapOffsets.chanterelle,brushCapOffsets.sleepyHand]){
    const genotype=[0,rule.cap,0,0,brushCapOffsets.accessory,0];
    assert.equal(compositionOffsetX(genotype,'accessory'),rule.x);
    assert.match(renderSVG(genotype),new RegExp(`<g transform="translate\\(${rule.x} 0\\)">`));
    const cap=cells(traits.cap[rule.cap]),shift=rule.x/5;
    assert.ok(darkBase.every(([x,y])=>cap.has(`${x+shift},${y}`)),'dark brush base must rest fully on the cap');
    if(rule===brushCapOffsets.chanterelle)assert.ok(darkBase.some(([x,y])=>!cap.has(`${x+shift+1},${y}`)),'Chanterelle must use the smallest whole-bead shift');
    else{
      const throughGap=woodenHandle.filter(([x,y])=>{const color=cap.get(`${x+shift},${y}`);return color===undefined||color===0;});
      assert.ok(throughGap.length>=20,'Hand of God brush handle must pass through the finger gap');
    }
  }
  assert.equal(compositionOffsetX([0,0,0,0,brushCapOffsets.accessory,0],'accessory'),0);
  assert.equal(compositionOffsetX([0,brushCapOffsets.chanterelle.cap,0,0,0,0],'accessory'),0);
});

test('all shipped interface, source, contracts, and metadata are English-only',async()=>{
  const roots=['apps/web/index.html','apps/web/assets/site.css','apps/web/mycelium.bundle.js','README.md','collection','apps/web/src','tooling','contracts','output/metadata','output/manifest.json','output/traits.json'];
  const files=[];
  for(const root of roots){
    const url=new URL(`../../../${root}`,import.meta.url);
    if(/\.[a-z]+$/i.test(root))files.push(url);
    else for(const entry of await readdir(url,{recursive:true}))if(/\.(?:js|mjs|sol|json)$/i.test(entry))files.push(new URL(`${root}/${entry}`,new URL('../../../',import.meta.url)));
  }
  for(const file of files)assert.doesNotMatch(await readFile(file,'utf8'),/\p{Script=Cyrillic}/u,file.pathname);
});
