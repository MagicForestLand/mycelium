import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import * as art from '../../collection/source/art.js';
import {generateBanks,generateSVGConstants} from './generate-banks.mjs';
import {tokenMetadata} from '../../collection/source/metadata.js';

import {generateMetadataContent,collectionMetadata,collectionCopyMarkdown} from './generate-metadata.mjs';

export function assertGeneratedSources(read = file => readFileSync(new URL('../../'+file,import.meta.url),'utf8')) {
  // Bound the entire catalog by additive layer maxima, including message JSON and
  // double Base64 expansion. A new trait must not consume the reserved extension space.
  const renderer=read('contracts/core/PhenotypeRenderer.sol');
  const limit=name=>Number(renderer.match(new RegExp(name+' = ([0-9_]+)'))[1].replaceAll('_',''));
  const baseBytes=Buffer.byteLength(art.OPEN+art.GROUP+art.CLOSE)+art.layerKeys.reduce((sum,key)=>sum+Math.max(...art.traits[key].map(t=>Buffer.byteLength(t.svg))),0);
  assert.ok(baseBytes<=128*1024,'Catalog base SVG exceeds 128 KiB; optimize artwork encoding before release');
  const maxSVG=baseBytes+limit('MAX_OVERLAY_BYTES');
  assert.ok(maxSVG<=limit('MAX_SVG_BYTES'),'Catalog leaves insufficient room for the full optional layer');
  const textBytes=t=>2*Buffer.byteLength(JSON.stringify(t.name))+Buffer.byteLength(JSON.stringify(t.description));
  const longestNotes=art.layerKeys.map(key=>art.traits[key].reduce((best,t,i,all)=>textBytes(t)>textBytes(all[best])?i:best,0));
  const metadata=tokenMetadata(longestNotes,{tokenId:art.combinations,svg:'x'.repeat(maxSVG)});
  // Conservative: 192 quote characters exceed the 3x24 scalar limit, but bound escaping.
  const message='"'.repeat(192);
  metadata.description+='\n\nMessage: '+message;
  metadata.attributes.push({trait_type:'Message',value:message});
  const maxURIBytes='data:application/json;base64,'.length+4*Math.ceil(Buffer.byteLength(JSON.stringify(metadata))/3);
  assert.ok(maxURIBytes<=limit('MAX_URI_BYTES'),'Catalog and optional message exceed the final URI budget');
  const banks=generateBanks(art.traits,art.layerKeys);
  const expected={
    'contracts/core/generated/MetadataContent.sol':generateMetadataContent(),
    'output/collection-metadata.json':JSON.stringify(collectionMetadata(),null,2)+'\n',
    'docs/collection/COLLECTION-CONTENT.md':collectionCopyMarkdown(),
    'contracts/core/generated/ArtBanks.sol':banks.source,
    'contracts/core/generated/GenomeSchema.sol':banks.schema,
    'contracts/core/generated/SVGConstants.sol':generateSVGConstants(art),
    'output/art-bank-manifest.json':JSON.stringify(banks.manifest,null,2)+'\n'
  };
  for(const [file,content] of Object.entries(expected))
    assert.equal(read(file),content,`${file} is stale; run npm run build before compiling or preparing a release`);
}
