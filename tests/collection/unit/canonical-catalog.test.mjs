import test from 'node:test';
import assert from 'node:assert/strict';
import {beadTraits as traits,beadPalette as palette} from '../../../collection/generated/bead-data.js';
import {decodeArtworkGrid} from '../../../collection/source/artwork-validation.js';

const grid=t=>decodeArtworkGrid(t.data,palette.length);
const reviewedIds=['brainwave','event-horizon','penrose-triangle','lunar-maria'];
const conceptIds=['skull-cairn','sleepy-hand','velvet-lips','parachute-day','melting-golden-hour','diamond-crown','cinnamon-curls','space-rift'];
const designerTemperamentIds=['bleh','cry-me-a-river','cherry-flirt','gilded-glam','glam-girl','i-got-it','macho-mustache','marigold-majesty','wait-what'];
const retiredDesignerTemperamentIds=['fancy-dreaming','knowing-wink','rainbow-mood','feeling-green','no-nonsense','ya-ya'];
const retainedAccessoryIds=['none','daisy-friend','painters-plume','encore-star'];
const designerStemIds=['golden-anatomy','frankenstem','cocoa-stomp','blush-stomp','blue-voltage','cyan-current','fresh-snow','ash-spark','red-letter'];
const intentionalOverlapIds=['skull-cairn','velvet-lips','parachute-day','melting-golden-hour','diamond-crown','cinnamon-curls','space-rift'];
const faceCrossingOverlayIds=['skull-cairn','space-rift'];
const reviewedCaps=reviewedIds.map(id=>traits.cap.find(t=>t.id===id));
const conceptCaps=conceptIds.map(id=>traits.cap.find(t=>t.id===id));
const newStems=designerStemIds.map(id=>traits.stem.find(t=>t.id===id));
test('the reviewed selection, Memento Mori and seven concepts coexist with 32 stems',()=>{
  assert.deepEqual(Object.values(traits).map(items=>items.length),[32,128,32,16,4,32]);
  assert.deepEqual(reviewedCaps.map(t=>t.id),reviewedIds);
  assert.deepEqual(conceptCaps.map(t=>t.id),conceptIds);
  assert.equal(new Set([...reviewedCaps,...conceptCaps].map(t=>t.data)).size,12);
  assert.equal(new Set(newStems.map(t=>t.data)).size,9);
  assert.equal(conceptCaps.find(t=>t.id==='skull-cairn').beads,1345);
  assert.equal(conceptCaps.find(t=>t.id==='diamond-crown').beads,1217);
  assert.equal(conceptCaps.find(t=>t.id==='cinnamon-curls').beads,1879);
  assert.equal(conceptCaps.find(t=>t.id==='sleepy-hand').beads,1168);
  assert.equal(conceptCaps.find(t=>t.id==='velvet-lips').beads,1630);
  assert.equal(conceptCaps.find(t=>t.id==='parachute-day').beads,1588);
  assert.equal(conceptCaps.find(t=>t.id==='melting-golden-hour').beads,1793);
  assert.equal(conceptCaps.find(t=>t.id==='space-rift').beads,1211);
  const conceptualPeel=traits.cap.find(t=>t.id==='pond-lilac');
  assert.equal(conceptualPeel.name,'Art Basil');
  assert.equal(conceptualPeel.beads,1308);
  assert.equal(traits.cap.at(-1).id,'pond-lilac');
});
test('accessories are reduced to three selected artworks plus the empty state',()=>{
  assert.deepEqual(traits.accessory.map(item=>item.id),retainedAccessoryIds);
  assert.deepEqual(traits.accessory.map(item=>item.name),['As You Are','Flower Power','Paint It Green','Starman']);
  assert.deepEqual(traits.accessory.map(item=>item.beads),[0,83,165,62]);
  assert.ok(traits.accessory.slice(1).every(item=>item.editedSource===`collection/artwork/traits/accessory/${item.id}.svg`));
});
test('John Karp replaces Hex Appeal without changing the glasses slot',()=>{
  const johnKarp=traits.glasses.find(item=>item.id==='honeycomb-frames');
  assert.equal(johnKarp.name,'John Karp');
  assert.equal(johnKarp.beads,46);
  assert.equal(johnKarp.editedSource,'collection/artwork/traits/glasses/honeycomb-frames.svg');
  assert.equal(traits.glasses.some(item=>item.name==='Hex Appeal'),false);
});
test('nine reviewed designer temperaments replace the generated set',()=>{
  const additions=traits.temperament.slice(-9);
  assert.deepEqual(additions.map(item=>item.id),designerTemperamentIds);
  assert.deepEqual(additions.map(item=>item.name),[
    'Jaded','Cry Me a River','Cherry Flirt','Refined','Fabulous','Bemused','Macho Mustache','Wonderstruck','Skeptical'
  ]);
  assert.equal(new Set(additions.map(item=>item.data)).size,9);
  assert.ok(additions.every(item=>item.beads>=14&&item.editedSource===`collection/artwork/traits/temperament/${item.id}.svg`));
  assert.equal(additions.find(item=>item.id==='cry-me-a-river').beads,64);
  for(const id of ['moss-prophet','cosmic-goatee','vine-and-dandy','two-river-blues','electric-cabaret','petal-lashes','technicolor-stubble']){
    assert.equal(traits.temperament.some(item=>item.id===id),false,id+' should be retired');
  }
  for(const id of retiredDesignerTemperamentIds)assert.equal(traits.temperament.some(item=>item.id===id),false,id+' should be removed');
});
test('the three designer Deep Water recolours sit directly after the original',()=>{
  const index=traits.cap.findIndex(t=>t.id==='porcini-cream');
  assert.deepEqual(traits.cap.slice(index,index+4).map(t=>t.id),[
    'porcini-cream','deep-water-cobalt','deep-water-violet','deep-water-kelp'
  ]);
  for(const trait of traits.cap.slice(index,index+4))assert.equal(trait.beads,1583);
});
test('every non-overlay concept cap has a zero-overlap socket for all stems, emotions and glasses',()=>{
  const reserved=new Set();
  for(const t of [...traits.stem,...traits.temperament,...traits.glasses])grid(t).forEach((c,i)=>{if(c>=0)reserved.add(i);});
  for(const t of conceptCaps.filter(t=>!intentionalOverlapIds.includes(t.id))){
    const g=grid(t);
    for(const i of reserved)assert.equal(g[i],-1,`${t.id} overlaps cell ${i%80},${Math.floor(i/80)}`);
    // The mounting seam must actually meet the 20-cell-wide top of the stem.
    for(let x=30;x<50;x++)assert.ok(g[34*80+x]>=0,`${t.id} floats above its stem at ${x}`);
  }
});
test('only designated overlay concepts cross the expression area',()=>{
  for(const id of intentionalOverlapIds){
    const g=grid(conceptCaps.find(t=>t.id===id));
    let crossesFace=false;
    for(let y=39;y<=55;y++)for(let x=32;x<=48;x++)if(g[y*80+x]>=0)crossesFace=true;
    assert.equal(crossesFace,faceCrossingOverlayIds.includes(id),`${id} expression-area overlap`);
  }
});
test('the curated designer stems retain their canonical art after palette grouping',()=>{
  assert.deepEqual(newStems.map(item=>item.id),designerStemIds);
  assert.deepEqual(newStems.map(item=>item.beads),[852,852,1096,1096,852,852,852,852,852]);
  assert.ok(newStems.every(item=>item.editedSource===`collection/artwork/traits/stem/${item.id}.svg`));
  for(const [index,item] of newStems.entries()){
    const occupied=[];
    grid(item).forEach((cell,position)=>{if(cell>=0)occupied.push(position);});
    const xs=occupied.map(position=>position%80),ys=occupied.map(position=>Math.floor(position/80));
    assert.equal(Math.min(...xs),index===2||index===3?2:26,item.id+' left edge');
    assert.equal(Math.max(...xs),54,item.id+' right edge');
    assert.equal(Math.min(...ys),35,item.id+' top edge');
    assert.equal(Math.max(...ys),70,item.id+' bottom edge');
  }
});
test('the curated designer stems are distinct works',()=>{
  assert.equal(new Set(newStems.map(item=>item.data)).size,9);
  assert.deepEqual(newStems.map(item=>item.name),[
    'X-Ray','Frankenstem','Cocoa Stomp','Blush Stomp','Electric Blue',
    'Cyan','Snow','Ash','Scarlet'
  ]);
});
test('stem swatches form colour groups, with Frankenstem directly after Nuclear Core',()=>{
  assert.deepEqual(traits.stem.map(item=>item.id),[
    'fresh-snow','silver','ash-spark','porcelain','vanilla','peach','terracotta','cocoa','red-wine',
    'lemon','honey','tangerine','red-letter','blush','orchid',
    'lavender','amethyst','ink','blue-voltage','cobalt','cyan-current','blue','turquoise',
    'mint','jade','matcha','acid',
    'golden-anatomy','nuclear-ember','frankenstem','cocoa-stomp','blush-stomp'
  ]);
});
