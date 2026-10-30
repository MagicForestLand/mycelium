import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {validateArtworkProject} from '../../collection/source/artwork-validation.js';

const layerIndexes={stem:0,cap:1,temperament:2,glasses:3,accessory:4,hobby:5};

const beadCount=data=>{
  assert.match(data,/^(?:[a-f0-9]{8})*$/);
  let count=0;
  for(let i=0;i<data.length;i+=8)count+=parseInt(data.slice(i+4,i+6),16);
  return count;
};

const payloadFromSVG=(svg,file)=>{
  const match=svg.match(/<metadata id="bead-editor-project">([\s\S]*?)<\/metadata>/);
  assert.ok(match,'Missing editor metadata in '+file);
  return JSON.parse(match[1].replaceAll('&lt;','<').replaceAll('&amp;','&'));
};

const remapData=(data,sourcePalette,palette,file)=>{
  let remapped='';
  for(let i=0;i<data.length;i+=8){
    const x=parseInt(data.slice(i,i+2),16);
    const y=parseInt(data.slice(i+2,i+4),16);
    const length=parseInt(data.slice(i+4,i+6),16);
    const sourceIndex=parseInt(data.slice(i+6,i+8),16);
    assert.ok(x<80&&y<80&&length>0&&x+length<=80&&sourceIndex<sourcePalette.length,'Invalid bead run in '+file);
    const color=sourcePalette[sourceIndex].toLowerCase();
    let targetIndex=palette.indexOf(color);
    if(targetIndex<0){
      assert.ok(palette.length<256,'Designer artwork exceeds the 256-color palette');
      targetIndex=palette.length;
      palette.push(color);
    }
    remapped+=data.slice(i,i+6)+targetIndex.toString(16).padStart(2,'0');
  }
  return remapped;
};

export async function loadArtworkRecords(root){
  const base=path.join(root,'collection/artwork');
  const records=[];
  const folder=path.join(base,'traits');
  const files=(await readdir(folder,{recursive:true})).filter(file=>file.endsWith('.svg')).sort();
  for(const relative of files){
    const file=path.posix.join('traits',relative.split(path.sep).join('/'));
    const payload=payloadFromSVG(await readFile(path.join(folder,relative),'utf8'),file);
    validateArtworkProject(payload.project);
    const edits=Object.entries(payload.project?.edits??{});
    assert.equal(edits.length,1,file+' must contain exactly one trait edit');
    const [[sourceKey,data]]=edits;
    const [layer,id]=sourceKey.split(':');
    assert.ok(layerIndexes[layer]!==undefined,'Unknown artwork layer '+layer+' in '+file);
    assert.ok(id,'Missing artwork trait id in '+file);
    if(payload.onlyLayer!==null&&payload.onlyLayer!==undefined){
      assert.equal(payload.onlyLayer,layerIndexes[layer],file+' has the wrong onlyLayer');
    }
    records.push({file,sourceKey,layer,id,data,palette:payload.project.palette,payload});
  }
  return records;
}

export async function applyArtwork(output,palette,root){
  const records=await loadArtworkRecords(root);
  const bySource=new Map();
  for(const record of records){
    const grouped=bySource.get(record.sourceKey)??[];
    grouped.push(record);
    bySource.set(record.sourceKey,grouped);
  }

  assert.ok(records.length>0,'No current designer artwork found');
  assert.equal(records.length,bySource.size,'Current artwork needs exactly one source per trait');

  let updated=0;
  for(const [sourceKey,sourceRecords] of bySource){
    const [layer,id]=sourceKey.split(':');
    const trait=output[layer].find(item=>item.id===id);
    assert.ok(trait,'Missing canonical trait for artwork '+sourceKey);
    assert.equal(sourceRecords.length,1,'Canonical artwork needs exactly one source: '+sourceKey);
    const [selected]=sourceRecords;
    const data=remapData(selected.data,selected.palette,palette,selected.file);
    trait.data=data;
    trait.beads=beadCount(data);
    trait.editedSource='collection/artwork/'+selected.file;
    updated++;
  }

  assert.equal(updated,bySource.size,'Not every current designer edit was applied');
  return {applied:updated,updated};
}
