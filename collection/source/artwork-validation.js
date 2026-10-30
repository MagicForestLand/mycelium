import assert from 'node:assert/strict';

const EDITOR_TYPE='mycelium-bead-editor';
const EDITOR_VERSION=3;
const GRID_SIZE=80;
const EMPTY_CELL=-1;
const LAYERS=['stem','cap','temperament','glasses','accessory','hobby'];
const validColor=color=>typeof color==='string'&&/^#[0-9a-f]{6}$/i.test(color);

export function decodeArtworkGrid(data,paletteLength){
  assert.match(data,/^(?:[0-9a-f]{8})*$/,'Invalid artwork bead data');
  assert.ok(data.length<=GRID_SIZE*GRID_SIZE*8,'Artwork bead data is too large');
  const grid=new Int16Array(GRID_SIZE*GRID_SIZE).fill(EMPTY_CELL);
  for(let offset=0;offset<data.length;offset+=8){
    const x=parseInt(data.slice(offset,offset+2),16),y=parseInt(data.slice(offset+2,offset+4),16);
    const length=parseInt(data.slice(offset+4,offset+6),16),color=parseInt(data.slice(offset+6,offset+8),16);
    assert.ok(x<GRID_SIZE&&y<GRID_SIZE&&length>0&&x+length<=GRID_SIZE&&color<paletteLength,'Artwork bead run is outside the grid or palette');
    grid.fill(color,y*GRID_SIZE+x,y*GRID_SIZE+x+length);
  }
  return grid;
}

export function validateArtworkProject(project,{basePalette=[],traitCounts=[]}={}){
  assert.equal(project?.type,EDITOR_TYPE,'Unsupported artwork project type');
  assert.equal(project.version,EDITOR_VERSION,'Unsupported artwork project version');
  assert.ok(Array.isArray(project.palette)&&project.palette.length>=80&&project.palette.length<=256,'Invalid artwork palette');
  assert.ok(project.palette.every(validColor),'Invalid artwork color');
  for(const [index,color] of basePalette.entries())assert.equal(project.palette[index]?.toLowerCase(),color.toLowerCase(),`Palette mismatch at ${index}`);
  assert.ok(Array.isArray(project.genotype)&&project.genotype.length===LAYERS.length,'Invalid artwork genotype');
  for(const [index,value] of project.genotype.entries()){
    assert.ok(Number.isInteger(value)&&value>=0,'Invalid artwork genotype index');
    if(traitCounts[index]!==undefined)assert.ok(value<traitCounts[index],'Artwork genotype index is outside the catalog');
  }
  assert.ok(project.edits&&typeof project.edits==='object'&&!Array.isArray(project.edits),'Invalid artwork edits');
  for(const [key,data] of Object.entries(project.edits)){
    const [layer,id,...extra]=key.split(':');
    assert.ok(LAYERS.includes(layer)&&id&&!extra.length,'Invalid artwork edit key');
    decodeArtworkGrid(data,project.palette.length);
  }
  assert.ok(Array.isArray(project.customTraits),'Invalid custom artwork list');
  assert.ok(Array.isArray(project.selectedCustom)&&project.selectedCustom.length===LAYERS.length,'Invalid custom artwork selection');
  assert.ok(Array.isArray(project.visibility)&&project.visibility.length===LAYERS.length&&project.visibility.every(value=>typeof value==='boolean'),'Invalid artwork visibility');
  assert.ok(Array.isArray(project.savedColors)&&project.savedColors.every(validColor),'Invalid saved artwork colors');
  assert.ok(Array.isArray(project.referenceColors)&&project.referenceColors.every(validColor),'Invalid reference artwork colors');
  assert.ok(Number.isInteger(project.activeLayer)&&project.activeLayer>=0&&project.activeLayer<LAYERS.length,'Invalid active artwork layer');
  assert.equal(project.reference,null,'Canonical artwork must not embed a raster reference');
  return project;
}
