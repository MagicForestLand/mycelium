import test from 'node:test';
import assert from 'node:assert/strict';
import {assertArtApproval,currentArtApproval} from '../../tooling/verification/artwork-release-lock.mjs';
test('all current SVGs, canonical data and authored sources match the release lock',()=>assert.doesNotThrow(()=>assertArtApproval()));
test('release lock detects changed art, collection branding, labels, order and palette',()=>{
  const original=currentArtApproval();
  for(const mutate of [c=>c.layers.cap[0].svgSha256='changed',c=>c.layers.cap[0].name='changed',c=>c.layers.cap.reverse(),c=>c.renderOrder.reverse(),c=>c.paletteSha256='changed',c=>c.collectionArtwork.genotype[0]=0,c=>c.collectionArtwork.avatarSha256='changed',c=>c.collectionArtwork.bannerSha256='changed',c=>c.sources['tooling/lib/generate-metadata.mjs']='changed',c=>c.sources['collection/catalog/catalog.json']='changed',c=>c.sources['collection/source/editorial.js']='changed']){
    const changed=structuredClone(original);mutate(changed);assert.throws(()=>assertArtApproval(changed),/Artwork differs/);
  }
});
