import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {beadPalette,beadTraits} from '../../../collection/generated/bead-data.js';
import {validateArtworkProject} from '../../../collection/source/artwork-validation.js';
import {loadArtworkRecords} from '../../../tooling/lib/artwork.mjs';

const root=fileURLToPath(new URL('../../..',import.meta.url));

const cells=(data,palette)=>{
  const result=new Map();
  for(let i=0;i<data.length;i+=8){
    const x=parseInt(data.slice(i,i+2),16);
    const y=parseInt(data.slice(i+2,i+4),16);
    const length=parseInt(data.slice(i+4,i+6),16);
    const color=palette[parseInt(data.slice(i+6,i+8),16)];
    for(let dx=0;dx<length;dx++)result.set((x+dx)+','+y,color);
  }
  return result;
};

test('all current artwork uses one canonical SVG source per trait',async()=>{
  const records=await loadArtworkRecords(root);
  const byFile=new Map(records.map(record=>[record.file,record]));

  for(const record of records){
    validateArtworkProject(record.payload.project,{basePalette:beadPalette.slice(0,80)});
    assert.equal('seed' in record.payload.project,false,record.file+' uses the current genotype field');
  }

  assert.equal(records.length,218);
  assert.equal(new Set(records.map(record=>record.sourceKey)).size,records.length);

  const applied=[];
  for(const [layer,items] of Object.entries(beadTraits)){
    for(const trait of items){
      if(!trait.editedSource?.startsWith('collection/artwork/'))continue;
      const file=trait.editedSource.slice('collection/artwork/'.length);
      const key=layer+':'+trait.id;
      const record=byFile.get(file);
      assert.ok(record,key+' source file');
      assert.equal(record.sourceKey,key,key+' source edit');
      assert.deepEqual(cells(trait.data,beadPalette),cells(record.data,record.palette),key);
      assert.equal(file,record.file,key);
      assert.ok(file.startsWith('traits/'),key+' canonical source');
      assert.equal(trait.beads,cells(trait.data,beadPalette).size,key);
      applied.push(key);
    }
  }

  assert.equal(applied.length,218);
  assert.deepEqual(Object.fromEntries(Object.entries(beadTraits).map(([layer,items])=>[
    layer,
    items.filter(item=>item.editedSource?.startsWith('collection/artwork/')).length
  ])),{
    stem:12,
    cap:126,
    temperament:31,
    glasses:15,
    accessory:3,
    hobby:31
  });
});
