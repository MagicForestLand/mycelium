import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {traits,layerKeys,renderLayerKeys,editions,OPEN,GROUP,CLOSE,renderSVG,beadPalette} from '../../collection/source/art.js';
import {collectionGenotype,collectionArtwork,bannerOpen,bannerClose} from '../lib/generate-metadata.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const lockPath=path.join(root,'collection/artwork/release-manifest.json');
const sha256=data=>createHash('sha256').update(data).digest('hex');

export function currentArtApproval(){
  const layers=Object.fromEntries(layerKeys.map(key=>[key,traits[key].map(t=>({id:t.id,name:t.name,svgSha256:sha256(OPEN+GROUP+t.svg+CLOSE),dataSha256:sha256(t.data)}))]));
  const avatar=collectionArtwork(),banner=bannerOpen+avatar+bannerClose;
  const sources=[...new Set(['tooling/lib/generate-metadata.mjs','collection/catalog/catalog.json','collection/source/editorial.js',...layerKeys.flatMap(k=>traits[k].map(t=>t.editedSource).filter(p=>p?.startsWith('collection/artwork/')))])].sort();
  return {layerOrder:layerKeys,renderOrder:renderLayerKeys,paletteSha256:sha256(JSON.stringify(beadPalette)),layers,
    editions:editions.map(e=>({slug:e.slug,name:e.name,genotype:e.genotype,svgSha256:sha256(renderSVG(e.genotype))})),
    collectionArtwork:{generator:'tooling/lib/generate-metadata.mjs',genotype:collectionGenotype,avatarSha256:sha256(avatar),bannerSha256:sha256(banner)},
    sources:Object.fromEntries(sources.map(file=>[file,sha256(readFileSync(path.join(root,file)))]))};
}

const summary=lock=>({format:lock.format,status:lock.status,approvedAt:lock.approvedAt,catalogSha256:lock.catalogSha256});

export function assertArtApproval(current=currentArtApproval()){
  const lock=JSON.parse(readFileSync(lockPath,'utf8'));
  assert.equal(lock.format,3);
  assert.equal(lock.status,'CURRENT_RELEASE_LOCK');
  assert.equal(sha256(JSON.stringify(lock.catalog)),lock.catalogSha256,'Release lock is internally inconsistent');
  assert.deepEqual(current,lock.catalog,'Artwork differs from the current release lock; review the exact correction and refresh the lock before release');
  return summary(lock);
}

export async function approveArt(reason){
  assert.ok(reason?.trim(),'A reason for refreshing the release lock is required');
  const catalog=currentArtApproval();
  const lock={format:3,status:'CURRENT_RELEASE_LOCK',approvedAt:new Date().toISOString(),reason:reason.trim(),catalogSha256:sha256(JSON.stringify(catalog)),catalog};
  await writeFile(lockPath,JSON.stringify(lock,null,2)+'\n');
  console.log(`Locked the current ${layerKeys.reduce((n,k)=>n+traits[k].length,0)} layers and ${editions.length} compositions for release.`);
  return summary(lock);
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  if(process.argv[2]==='approve')await approveArt(process.argv.slice(3).join(' '));
  else console.log('PASS: artwork and copy match the current release lock '+assertArtApproval().catalogSha256);
}
