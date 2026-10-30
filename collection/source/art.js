/* Beaded SVG edition. bead-data.js is generated from the current authoring
   modules and approved catalog data, then shared with the Solidity art banks. */
import { beadPalette, beadTraits, beadEditions } from '../generated/bead-data.js';
export const INK = '#080918';
export const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">';
export const DEFS = '<defs><radialGradient id="bs-shine" cx="30%" cy="24%" r="78%"><stop stop-color="#fff" stop-opacity=".58"/><stop offset=".22" stop-color="#fff" stop-opacity=".12"/><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".8"/></radialGradient><g id="bs-bead"><circle cx="2.5" cy="2.5" r="2.3"/><circle cx="2.5" cy="2.5" r="2.3" fill="url(#bs-shine)"/></g>' + beadPalette.map((color,i)=>`<pattern id="bs-p${i}" width="5" height="5" patternUnits="userSpaceOnUse"><use href="#bs-bead" fill="${color}"/></pattern>`).join('') + '</defs>';
export const GROUP = DEFS + '<g>';
export const CLOSE = '</g></svg>';
export const layerKeys = ['stem','cap','temperament','glasses','accessory','hobby'];
// Genotype bytes stay in layerKeys order; only SVG compositing uses this back-to-front order.
export const renderLayerKeys = ['stem','temperament','glasses','cap','accessory','hobby'];
export const renderLayerIndexes = renderLayerKeys.map(key=>layerKeys.indexOf(key));
export const layerNames = {stem:'Stem',cap:'Cap',temperament:'Temperament',glasses:'Glasses',accessory:'Accessory',hobby:'Hobby'};
// Paint It Green needs a cap-specific horizontal nudge so its dark base
// rests on these two silhouettes. Indices are release data and are guarded by tests.
export const brushCapOffsets = Object.freeze({
  accessory:2,
  chanterelle:Object.freeze({cap:32,x:-45}),
  sleepyHand:Object.freeze({cap:120,x:-90})
});
export const exportBackgrounds = [
  {id:'black',name:'Black',color:'#000000'}
];
// Four bytes per horizontal run: column, row, bead count, palette index.
// Rectangles cover whole 5x5 cells, so no bead is clipped at the silhouette.
export function decodeBeads(data) {
  if(!/^(?:[a-f0-9]{8})*$/.test(data)) throw new RangeError('Invalid bead data.');
  let svg='';
  for(let i=0;i<data.length;i+=8){
    const x=parseInt(data.slice(i,i+2),16),y=parseInt(data.slice(i+2,i+4),16);
    const count=parseInt(data.slice(i+4,i+6),16),color=parseInt(data.slice(i+6,i+8),16);
    if(x>=80||y>=80||count<1||x+count>80||color>=beadPalette.length)throw new RangeError('Invalid bead run.');
    svg+=`<path fill="url(#bs-p${color})" d="M${x*5} ${y*5}h${count*5}v5h-${count*5}z"/>`;
  }
  return svg;
}
function traitWithLazySVG(item){
  const trait={...item};let svg;
  Object.defineProperty(trait,'svg',{enumerable:true,get(){
    // Build tools reuse decoded SVG. The browser paints compact run data directly
    // and only decodes an SVG for an explicit download, so it must not retain the
    // expanded 2.5 MB trait catalog for the rest of the session.
    return typeof document==='undefined'?(svg??=decodeBeads(item.data)):decodeBeads(item.data);
  }});
  return trait;
}
export const traits = Object.fromEntries(layerKeys.map(key=>[key,beadTraits[key].map(traitWithLazySVG)]));
export const combinations = layerKeys.reduce((n,k) => n * traits[k].length, 1);
export const editions = beadEditions;
export { beadPalette };

export function validateGenotype(genotype) {
  if (!Array.isArray(genotype) || genotype.length !== layerKeys.length) throw new RangeError('Genotype must have six trait indices.');
  genotype.forEach((v,i) => { if(!Number.isInteger(v) || v < 0 || v >= traits[layerKeys[i]].length) throw new RangeError(`Invalid ${layerKeys[i]} index: ${v}`); });
  return genotype;
}
export function namespaceSVG(svg, namespace) {
  if(!/^[A-Za-z][A-Za-z0-9_-]*$/.test(namespace))throw new RangeError('Invalid SVG namespace.');
  return namespace==='bs'?svg:svg.replaceAll('bs-',namespace+'-');
}
export function compositionOffsetX(genotype,key) {
  if(key!=='accessory'||genotype[layerKeys.indexOf('accessory')]!==brushCapOffsets.accessory)return 0;
  const cap=genotype[layerKeys.indexOf('cap')];
  if(cap===brushCapOffsets.chanterelle.cap)return brushCapOffsets.chanterelle.x;
  if(cap===brushCapOffsets.sleepyHand.cap)return brushCapOffsets.sleepyHand.x;
  return 0;
}
export function renderTraitSVG(genotype,key,items=traits) {
  const svg=items[key][genotype[layerKeys.indexOf(key)]].svg,offset=compositionOffsetX(genotype,key);
  return offset?`<g transform="translate(${offset} 0)">${svg}</g>`:svg;
}
export function renderSVG(genotype, {background = null, namespace = 'bs'} = {}) {
  validateGenotype(genotype);
  if(background!==null&&(!Number.isInteger(background)||background<0||background>=exportBackgrounds.length))throw new RangeError(`Invalid export background: ${background}`);
  const backdrop=background===null?'':`<path fill="${exportBackgrounds[background].color}" d="M0 0h400v400H0z"/>`;
  return namespaceSVG(OPEN + GROUP + backdrop + renderLayerKeys.map(key=>renderTraitSVG(genotype,key)).join('') + CLOSE,namespace);
}
export function attributes(genotype) {
  validateGenotype(genotype);
  return layerKeys.map((key,i) => ({trait_type:layerNames[key], value:traits[key][genotype[i]].name}));
}
// Descriptor input: six immutable bytes stored by the NFT at mint.
export function packGenotype(genotype) {
  validateGenotype(genotype);
  return genotype.reduce((packed,value,i) => packed | (BigInt(value) << BigInt(i*8)),0n);
}
export function unpackGenotype(packed) {
  const value = BigInt(packed);
  if (value < 0n || value >= (1n << 48n)) throw new RangeError('Genotype does not fit uint48.');
  return validateGenotype(layerKeys.map((_,i) => Number((value >> BigInt(i*8)) & 255n)));
}
export function genotypeFromNumber(value) {
  if(!Number.isSafeInteger(value) || value < 0 || value >= combinations) throw new RangeError('Edition index out of range.');
  return layerKeys.map(key => {const n=value % traits[key].length; value=Math.floor(value/traits[key].length); return n;});
}
