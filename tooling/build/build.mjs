import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {transform} from 'esbuild';
import {generateBanks,generateSVGConstants} from '../lib/generate-banks.mjs';
import { traits, layerKeys, renderLayerKeys, layerNames, brushCapOffsets, exportBackgrounds, editions, combinations, renderSVG, attributes, packGenotype, OPEN, GROUP, CLOSE, beadPalette } from '../../collection/source/art.js';

import {tokenMetadata} from '../../collection/source/metadata.js';
import {generateMetadataContent,collectionMetadata,collectionArtwork,collectionCopyMarkdown,bannerOpen,bannerClose} from '../lib/generate-metadata.mjs';

const root = fileURLToPath(new URL('../../',import.meta.url));
const save = async (file, data) => { const target=path.join(root,file); await mkdir(path.dirname(target),{recursive:true}); await writeFile(target,data); };
const byteSize = text => Buffer.byteLength(text);
const json = value => JSON.stringify(value,null,2)+'\n';
const records=[];
if(beadPalette.length>256||beadPalette.some(color=>!/^#[0-9a-f]{6}$/i.test(color)))throw new Error('Invalid birth palette');
// Validate the catalog before replacing any exports; counts are deliberately not frozen here.
const banks=generateBanks(traits,layerKeys);
for(const directory of ['output/svg','output/transparent','output/metadata','output/layers']){
  await rm(path.join(root,directory),{recursive:true,force:true});
}
for(let i=0;i<editions.length;i++) {
  const item=editions[i], svg=renderSVG(item.genotype), file=`${String(i+1).padStart(2,'0')}-${item.slug}`;
  await save(`output/svg/${file}.svg`,svg);
  await save(`output/transparent/${file}.svg`,svg);
  await save(`output/metadata/${file}.json`,json(tokenMetadata(item.genotype,{tokenId:i+1})));
  records.push({...item,file:`svg/${file}.svg`,bytes:byteSize(svg),packedGenotype:packGenotype(item.genotype).toString()});
}
let tiles='';
editions.forEach((item,i) => { tiles+=`<svg x="${i%4*400}" y="${Math.floor(i/4)*400}" width="400" height="400" viewBox="0 0 400 400">${renderSVG(item.genotype,{namespace:`e${i}`}).replace(OPEN,'').replace(/<\/svg>$/,'')}</svg>`; });
await save('output/collection.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${Math.ceil(editions.length/4)*400}" viewBox="0 0 1600 ${Math.ceil(editions.length/4)*400}">${tiles}</svg>`);
for(const key of layerKeys) for(const item of traits[key]) {
  await save(`output/layers/${key}/${item.id}.svg`,OPEN+GROUP+item.svg+CLOSE);
}
await save('output/traits.json',json(Object.fromEntries(layerKeys.map(k => [k,traits[k]]))));
await save('output/manifest.json',json({collection:'Mycelium Friends',format:'mycelium-art-manifest-20261023',style:'Glass beads',canvas:'Transparent',studioBackground:exportBackgrounds[0].name,viewBox:'0 0 400 400',genotypeOrder:layerKeys,renderOrder:renderLayerKeys,traitCounts:Object.fromEntries(layerKeys.map(k=>[k,traits[k].length])),combinations,encodedTraitsBytes:layerKeys.reduce((n,k)=>n+traits[k].reduce((m,t)=>m+(t.data?.length||0)/2,0),0),traitsBytes:layerKeys.reduce((n,k)=>n+traits[k].reduce((m,t)=>m+byteSize(t.svg),0),0),editions:records}));

await save('contracts/core/generated/ArtBanks.sol',banks.source);
await save('contracts/core/generated/GenomeSchema.sol',banks.schema);
await save('output/art-bank-manifest.json',json(banks.manifest));
const referenceMap=Array.from({length:38},(_,i)=>({reference:`in/inspirations/mushroom-ref-${String(i+1).padStart(3,'0')}.png`,traits:Object.fromEntries(layerKeys.filter(k=>k!=='stem').map(k=>[k,traits[k].filter(t=>t.reference?.includes(i+1)).map(t=>t.id)])),edition:records.find(e=>e.reference===i+1)?.file}));
await save('output/reference-map.json',json(referenceMap));
await save('contracts/core/generated/SVGConstants.sol',generateSVGConstants({OPEN,GROUP,CLOSE,layerKeys,layerNames,renderLayerKeys,brushCapOffsets}));
await save('contracts/core/generated/MetadataContent.sol',generateMetadataContent());
await save('output/collection-metadata.json',json(collectionMetadata()));
await save('output/branding/avatar.svg',collectionArtwork());
await save('output/branding/banner.svg',bannerOpen+collectionArtwork()+bannerClose);
await save('docs/collection/COLLECTION-CONTENT.md',collectionCopyMarkdown());
const previewGenotype=[4,2,0,9,0,0];
const previewTraits=renderLayerKeys.map(key=>traits[key][previewGenotype[layerKeys.indexOf(key)]]);
const previewColors=new Set();
for(const trait of previewTraits)for(let i=6;i<trait.data.length;i+=8)previewColors.add(parseInt(trait.data.slice(i,i+2),16));
const previewDefs='<defs><radialGradient id="bs-shine" cx="30%" cy="24%" r="78%"><stop stop-color="#fff" stop-opacity=".58"/><stop offset=".22" stop-color="#fff" stop-opacity=".12"/><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".8"/></radialGradient><g id="bs-bead"><circle cx="2.5" cy="2.5" r="2.3"/><circle cx="2.5" cy="2.5" r="2.3" fill="url(#bs-shine)"/></g>'+[...previewColors].sort((a,b)=>a-b).map(i=>`<pattern id="bs-p${i}" width="5" height="5" patternUnits="userSpaceOnUse"><use href="#bs-bead" fill="${beadPalette[i]}"/></pattern>`).join('')+'</defs>';
await save('output/branding/preview.svg',OPEN+previewDefs+'<g>'+previewTraits.map(trait=>trait.svg).join('')+CLOSE);
const previewAlt=layerKeys.map((key,index)=>traits[key][previewGenotype[index]].name).join(', ').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
const homeHTML=await readFile(path.join(root,'apps/web/index.html'),'utf8');
const updatedHomeHTML=homeHTML.replace(/(<img id="preview"[^>]* alt=")[^"]*(")/,(_,before,after)=>before+previewAlt+after);
if(updatedHomeHTML!==homeHTML){
  const target=path.join(root,'apps/web/index.html'),temporary=`${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary,updatedHomeHTML);
  await rename(temporary,target);
}
const editorialSource=(await readFile(path.join(root,'collection/source/editorial.js'),'utf8')).replace(/^export /gm,'');
const metadataSource=(await readFile(path.join(root,'collection/source/metadata.js'),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const beadSource=(await readFile(path.join(root,'collection/generated/bead-data.js'),'utf8')).replace(/^export /gm,'');
const artSource=(await readFile(path.join(root,'collection/source/art.js'),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export \{.*\};\n/gm,'').replace(/^export /gm,'');
const tokenSource=(await readFile(path.join(root,'collection/source/token-id.js'),'utf8')).replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
const pricingSource=(await readFile(path.join(root,'apps/web/src/mint-price.js'),'utf8')).replace(/^export /gm,'');
const usdSource=(await readFile(path.join(root,'apps/web/src/eth-usd.js'),'utf8')).replace(/^export /gm,'');
const fundraisingSource=(await readFile(path.join(root,'apps/web/src/fundraising.js'),'utf8')).replace(/^export /gm,'');
const marketplaceSource=(await readFile(path.join(root,'apps/web/src/marketplace.js'),'utf8')).replace(/^export /gm,'');
const xShareSource=(await readFile(path.join(root,'apps/web/src/x-share.js'),'utf8')).replace(/^export /gm,'');
const myceliumSource=await readFile(path.join(root,'apps/web/src/mycelium.js'),'utf8');
const spiralSource=(await readFile(path.join(root,'apps/web/src/spiral-geometry.js'),'utf8')).replace(/^export /gm,'');
const starfieldSource=await readFile(path.join(root,'apps/web/src/starfield.js'),'utf8');
const appBundle=`(()=>{\n${beadSource}\n${artSource}\n${tokenSource}\n${editorialSource}\n${metadataSource}\n${pricingSource}\n${usdSource}\n${fundraisingSource}\n${marketplaceSource}\n${xShareSource}\n${spiralSource}\n${myceliumSource}\n${starfieldSource}\n})();\n`;
const appBuild=await transform(appBundle,{minify:true,target:'es2022'});
await save('apps/web/mycelium.bundle.js','// Generated by npm run build.\n'+appBuild.code);
console.log(`Built ${records.length} editions, ${layerKeys.reduce((n,k)=>n+traits[k].length,0)} SVG layers, ${combinations.toLocaleString()} combinations.`);
console.log(`SVG size: ${Math.min(...records.map(r=>r.bytes))}–${Math.max(...records.map(r=>r.bytes))} bytes.`);
