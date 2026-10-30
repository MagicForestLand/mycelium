import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import solc from 'solc';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory} from 'ethers';
import * as art from '../../collection/source/art.js';
import {collectionCopy} from '../../collection/source/editorial.js';
import {generateMetadataContent,collectionCopyMarkdown} from '../../tooling/lib/generate-metadata.mjs';
import {generateBanks,generateSVGConstants} from '../../tooling/lib/generate-banks.mjs';
import {compilerSettings,projectRoot} from '../../tooling/lib/compile-contracts.mjs';

test('raw URL and layer names reject unsafe bytes, Unicode and non-string inputs',()=>{
  const bad=[undefined,null,42,{},[], '', 'bad"quote','bad\\slash','bad\nline','bad\u0000control','bad\u001fcontrol','bad\u007fcontrol','🍄','Stem\ud800'];
  for(const value of bad){
    assert.throws(()=>generateMetadataContent({...collectionCopy,projectURL:value}),/PROJECT_URL/);
    assert.throws(()=>generateSVGConstants({...art,layerNames:{...art.layerNames,stem:value}}),/layerNames.stem/);
  }
  for(const url of ['https://example.com/"x','https://example.com/\\x','https://example.com/\nx','https://example.com/🍄','relative/path','javascript:alert(1)','data:text/plain,hello','https://','https://exa mple.com/','https://user:pass@example.com/','https://example.com/%oops'])
    assert.throws(()=>generateMetadataContent({...collectionCopy,projectURL:url}),/PROJECT_URL/);
  for(const url of ['https://magicforest.land/','http://localhost:8080/a','https://example.com/a%22b?q=%5C&x=1#ok'])
    assert.doesNotThrow(()=>generateMetadataContent({...collectionCopy,projectURL:url}));
});

test('trait publication text rejects markup, quotes, escapes, controls and Unicode',()=>{
  for(const field of ['name','description'])for(const value of ['bad<tag>','bad&entity','bad"quote','bad\\slash','bad\nline','bad\u0000control','bad\u001fcontrol','bad\u007fcontrol','🍄']){
    const traits=Object.fromEntries(art.layerKeys.map(key=>[key,art.traits[key].map(t=>({...t}))]));
    traits.cap[0][field]=value;
    assert.throws(()=>generateBanks(traits,art.layerKeys),/unsafe/);
  }
});

test('current generated production metadata and layer constants stay byte-identical',()=>{
  assert.equal(generateMetadataContent(),readFileSync(new URL('../../contracts/core/generated/MetadataContent.sol',import.meta.url),'utf8'));
  assert.equal(collectionCopyMarkdown(),readFileSync(new URL('../../docs/collection/COLLECTION-CONTENT.md',import.meta.url),'utf8'));
  assert.equal(generateSVGConstants(art),readFileSync(new URL('../../contracts/core/generated/SVGConstants.sol',import.meta.url),'utf8'));
  for(const field of ['tokenDescription','name']){
    for(const value of [undefined,null,42,{}])assert.throws(()=>generateMetadataContent({...collectionCopy,[field]:value}),/string/);
    assert.throws(()=>generateMetadataContent({...collectionCopy,[field]:'🍄'}),/ASCII/);
  }
  assert.throws(()=>generateMetadataContent(collectionCopy,null),/string/);
});

test('compiled metadata round-trips quotes, backslashes, newline and controls without runtime changes',async()=>{
  const message='A mushroom says "hello" \\ path\n\t\r\b\f\u0000\u001f';
  const copy={...collectionCopy,name:message,tokenDescription:message,projectURL:'https://example.com/a%22b?q=%5C&x=1'};
  const sources={
    'contracts/core/MetadataEncoder.sol':{content:readFileSync(`${projectRoot}/contracts/core/MetadataEncoder.sol`,'utf8')},
    'contracts/core/generated/MetadataContent.sol':{content:generateMetadataContent(copy,message)}
  };
  const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:compilerSettings}),{import:file=>{
    try{return{contents:readFileSync(`${projectRoot}/${file.startsWith('@')?'node_modules/':''}${file}`,'utf8')}}catch{return{error:`Missing ${file}`}}
  }}));
  assert.deepEqual((compiled.errors||[]).filter(e=>e.severity==='error'),[]);
  const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'}});
  try{
    const provider=new BrowserProvider(local);provider.pollingInterval=10;
    const artifact=compiled.contracts['contracts/core/MetadataEncoder.sol'].MetadataEncoder;
    const encoder=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,await provider.getSigner()).deploy();
    await encoder.waitForDeployment();
    const decode=uri=>JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString());
    const token=decode(await encoder.tokenURI(1,'<svg/>','0x','0x'));
    const collection=decode(await encoder.contractURI());
    assert.equal(token.description,message);assert.equal(collection.name,message);assert.equal(collection.description,message);
    assert.equal(token.external_url,copy.projectURL);assert.equal(collection.external_link,copy.projectURL);
    assert.deepEqual(token.attributes,[]);
  }finally{await local.disconnect();}
});
