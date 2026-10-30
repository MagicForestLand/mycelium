import {traits,layerKeys,layerNames,validateGenotype,renderSVG,attributes} from './art.js';
import {collectionCopy} from './editorial.js';

export function friendDescription(genotype) {
  validateGenotype(genotype);
  return collectionCopy.tokenDescription + layerKeys.map((key,i)=>{
    const trait=traits[key][genotype[i]];
    return '\n\n'+layerNames[key]+' - '+trait.name+': '+trait.description;
  }).join('');
}

// All authored SVG and copy is ASCII. btoa works in Node and the browser.
export function tokenMetadata(genotype, {tokenId, svg=renderSVG(genotype)}={}) {
  if(tokenId!==undefined&&(!Number.isSafeInteger(tokenId)||tokenId<1))throw new RangeError('Sequential token ID required.');
  return {
    name: tokenId===undefined?'Mycelium Friend':'Mycelium Friend #'+tokenId,
    description: friendDescription(genotype),
    external_url: collectionCopy.projectURL,
    image: 'data:image/svg+xml;base64,'+btoa(svg),
    attributes: attributes(genotype)
  };
}
