import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {transform} from 'esbuild';
import {projectRoot} from '../lib/compile-contracts.mjs';

const tracked=execFileSync('git',['ls-files','-z','apps/web'],{cwd:projectRoot,encoding:'utf8'}).split('\0').filter(Boolean);
const authoredJS=tracked.filter(file=>file.startsWith('apps/web/src/')&&file.endsWith('.js'));
const htmlPath='apps/web/index.html',cssPaths=['apps/web/assets/site.css','apps/web/assets/chain.css','apps/web/assets/protected-mint.css'];
const read=file=>readFile(path.join(projectRoot,file),'utf8');

for(const file of authoredJS){
  const result=await transform(await read(file),{loader:'js',sourcefile:file,target:'es2022',logLevel:'silent'});
  assert.equal(result.warnings.length,0,`${file} has JavaScript parser warnings`);
}

const html=await read(htmlPath);
const inlineScripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).filter(source=>source.trim());
for(const [index,source] of inlineScripts.entries()){
  const result=await transform(source,{loader:'js',sourcefile:`${htmlPath}#script-${index+1}`,target:'es2022',logLevel:'silent'});
  assert.equal(result.warnings.length,0,`Inline script ${index+1} has parser warnings`);
}

const inlineStyles=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match=>match[1]);
for(const [file,source] of [...await Promise.all(cssPaths.map(async file=>[file,await read(file)])),...inlineStyles.map((source,index)=>[`${htmlPath}#style-${index+1}`,source])]){
  const result=await transform(source,{loader:'css',sourcefile:file,target:'es2022',logLevel:'silent'});
  assert.equal(result.warnings.length,0,`${file} has CSS parser warnings`);
}

const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]),idSet=new Set(ids);
assert.equal(idSet.size,ids.length,`Duplicate HTML ids: ${ids.filter((id,index)=>ids.indexOf(id)!==index).join(', ')}`);
const assertTargets=(pattern,label)=>{
  for(const match of html.matchAll(pattern))for(const id of match[1].trim().split(/\s+/))assert.ok(idSet.has(id),`${label} references missing #${id}`);
};
assertTargets(/\b(?:aria-controls|aria-describedby|aria-labelledby|for)="([^"]+)"/g,'HTML relation');
assertTargets(/<use\b[^>]*\bhref="#([^"]+)"/g,'SVG use');

const applicationRoutes=new Set(['spiral','traits','about','history','wishlist','myfriends','forest','collection']);
for(const match of html.matchAll(/\bhref="([^"]+)"/g)){
  const href=match[1];
  assert.ok(!/^javascript:/i.test(href),`Executable href is forbidden: ${href}`);
  if(/^https?:/i.test(href))assert.equal(new URL(href).protocol,'https:',`External URL must use HTTPS: ${href}`);
  if(href.startsWith('#')){
    const fragment=href.slice(1).split('?')[0],route=fragment.split('=')[0];
    assert.ok(idSet.has(fragment)||applicationRoutes.has(route)||route==='genotype',`Unknown local route or fragment: ${href}`);
  }
}
for(const match of html.matchAll(/<a\b([^>]*\btarget="_blank"[^>]*)>/g)){
  const rel=match[1].match(/\brel="([^"]+)"/)?.[1]?.split(/\s+/)??[];
  assert.ok(rel.includes('noopener')&&rel.includes('noreferrer'),'Every target="_blank" link must isolate its opener and referrer');
}

const staging=JSON.parse(await read('apps/web/config/mainnet-staging-site.json'));
assert.equal(staging.mode,'read-only','Mainnet staging must stay read-only during M4');
assert.equal(new URL(staging.deployment.rpcUrl).protocol,'https:');
assert.equal(new URL(staging.deployment.snapshotUrl).protocol,'https:');
const exportedEntrypoints=html+'\n'+await read('apps/web/src/mycelium.js');
assert.doesNotMatch(exportedEntrypoints,/\b(?:sepolia|testnet)\b|mycelium-friends-sepolia|magicforest\.land\/api\/mycelium\/snapshot/i,'Public authored entry points contain a retired/test-network string');
assert.equal([...html.matchAll(/\bdata-placeholder(?:=|\s|>)/g)].length,0,'Public authored entry points must not retain unresolved placeholders');

console.log(`PASS web static quality: ${authoredJS.length} authored JS files, ${cssPaths.length+inlineStyles.length} CSS sources, ${inlineScripts.length} inline scripts, ${ids.length} unique ids and secure authored links.`);
