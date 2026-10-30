import assert from 'node:assert/strict';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {siteSourcePath} from './site-paths.mjs';

// Deliberately finite: these are generated/runtime artifacts, never implicit
// permission to import an arbitrary missing or private source file.
const runtimePaths=new Set(['apps/web/chain-config.json','deployments/core/ethereum/mainnet.json','apps/web/mycelium.bundle.js','apps/web/assets/web3/app.js','.dev/chain','output/manifest.json','output/branding/avatar.svg','output/branding/preview.svg']);
const privateRuntimePaths=new Set(['internal/testnet/testnet-config.json','internal/testnet/web3/app.js']);
const external=value=>/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value);
export function referencesInText(file,text){
  const refs=[];
  const add=(value,kind,root=false)=>{if(value&&!external(value))refs.push({value,kind,root:root||value.startsWith('/')});};
  if(/\.(?:m?js|sol)$/.test(file)){
    // Tokenize strings/comments so quoted fixture code and generated HTML are not
    // mistaken for imports executed by this module. Dynamic paths stay runtime-tested.
    const tokens=[...text.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|`(?:\\[\s\S]|[^`\\])*`|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[A-Za-z_$][\w$]*|[^\s]/g)].map(m=>m[0]).filter(t=>!t.startsWith('//')&&!t.startsWith('/*'));
    const literal=t=>t&&/^["']/.test(t)?t.slice(1,-1):null;
    for(let i=0;i<tokens.length;i++){
      if(tokens[i]==='import'){
        const direct=literal(tokens[i+1])||(tokens[i+1]==='('?literal(tokens[i+2]):null);
        if(direct&&(direct.startsWith('.')||direct.startsWith('/')))add(direct,'import');
      }
      if(tokens[i]==='from'){
        const value=literal(tokens[i+1]);if(value&&(value.startsWith('.')||value.startsWith('/')))add(value,'import');
      }
      if(tokens.slice(i,i+3).join(' ')==='new URL ('){
        const value=literal(tokens[i+3]);
        if(value&&tokens.slice(i+4,i+11).join('')===',import.meta.url)')add(value,'file URL');
      }
    }
  }
  if(file.endsWith('.md'))for(const match of text.matchAll(/\]\(<?([^\s)>]+)>?(?:\s+"[^"]*")?\)/g))add(match[1],'documentation link');
  if(file.endsWith('.html')){
    for(const match of text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g))add(match[1],'HTML asset');
    for(const match of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))for(const ref of referencesInText(file+'.js',match[1]))add(ref.value,'HTML module',ref.root);
  }
  if(file==='package.json')for(const command of Object.values(JSON.parse(text).scripts||{}))for(const match of command.matchAll(/(?:^|\s)(?:\.\/)?((?:tooling|internal)\/[^\s;&]+\.(?:mjs|sh))/g))add(match[1],'npm entrypoint',true);
  if(file.endsWith('.yml')||file.endsWith('.sh'))for(const match of text.matchAll(/\b(tooling\/[\w/.-]+\.mjs)\b/g))add(match[1],'tool entrypoint',true);
  return refs;
}

export function referenceFindings(files,read,{publicOnly=true}={}){
  const selected=new Set(files),findings=[];
  const contains=target=>target==='.'||selected.has(target)||files.some(file=>file.startsWith(target.replace(/\/$/,'')+'/'));
  for(const file of files){
    if(!/\.(?:md|m?js|sol|html|yml|sh)$/.test(file)&&file!=='package.json')continue;
    const text=read(file);
    for(const {value,kind,root} of referencesInText(file,text)){
      const clean=decodeURIComponent(value.split(/[?#]/)[0]).replace(/^\//,'');
      const htmlRuntime=kind.startsWith('HTML ')&&(root||file==='apps/web/index.html');
      const target=path.posix.normalize(htmlRuntime?siteSourcePath(path.posix.normalize(clean)):root?clean:path.posix.join(path.posix.dirname(file),clean)).replace(/\/$/,'');
      if(publicOnly&&(target==='internal'||target.startsWith('internal/')))findings.push({file,kind,value,reason:'private dependency'});
      else if(target.startsWith('../')||(!contains(target)&&!runtimePaths.has(target)&&!(!publicOnly&&privateRuntimePaths.has(target))))findings.push({file,kind,value,reason:'unresolved reference'});
    }
  }
  return findings;
}

export function assertRepositoryReferences(files,root,options){
  const findings=referenceFindings(files,file=>readFileSync(path.join(root,file),'utf8'),options);
  assert.deepEqual(findings,[],'Repository references must resolve within the selected source boundary');
}
