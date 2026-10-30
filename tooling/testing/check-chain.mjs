import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, keccak256 } from 'ethers';
import {layerKeys,traits,brushCapOffsets,editions,renderSVG,packGenotype,attributes,genotypeFromNumber,combinations,beadPalette} from '../../collection/source/art.js';
import {checkProtection} from '../lib/check-protection.mjs';
import {checkSettlement} from '../lib/check-settlement.mjs';
import {checkMint} from '../lib/check-mint.mjs';
import {checkRenderer} from '../lib/check-renderer.mjs';
import {checkCoreProtocol} from '../lib/check-core-protocol.mjs';
import {checkRoyalties} from './check-royalties.mjs';
import {checkAllowlist} from './check-allowlist.mjs';
import {compileContracts,artifactFor} from '../lib/compile-contracts.mjs';
import {deploymentPlan,catalogFingerprint} from '../lib/deployment-plan.mjs';
import {verifyDeployment} from '../lib/verify-deployment.mjs';
import {resolvedDeployment} from '../lib/release-binding.mjs';


import {tokenMetadata} from '../../collection/source/metadata.js';

const coreOnly=process.argv.includes('--core-only');
const root=fileURLToPath(new URL('../../',import.meta.url));
const runStage=async(label,action)=>{
  const started=Date.now();
  console.log(`RUN: ${label}`);
  const heartbeat=setInterval(()=>console.log(`WORKING: ${label} · ${Math.round((Date.now()-started)/1000)}s elapsed`),20_000);
  heartbeat.unref();
  try{
    const result=await action();
    console.log(`DONE: ${label} · ${Math.round((Date.now()-started)/1000)}s`);
    return result;
  }finally{clearInterval(heartbeat);}
};
console.log('RUN: compile production contracts');
const {compiled,compiler,sourceHashes}=compileContracts();
console.log('DONE: compile production contracts');
await rm(path.join(root,'output/contracts'),{recursive:true,force:true});
await mkdir(path.join(root,'output/contracts'),{recursive:true});
await mkdir(path.join(root,'output/reports'),{recursive:true});
// Use a high local block limit so Ganache does not reject diagnostic eth_call
// budgets as if they were target transaction limits. Suite transactions remain far below it.
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai',allowUnlimitedContractSize:false},wallet:{totalAccounts:3},miner:{blockGasLimit:200_000_000}});
try{
  const provider=new BrowserProvider(local);provider.pollingInterval=10;
  const signer=await provider.getSigner();
  const deployedAddresses={},artifacts={},deploymentInitcodes={};
  artifacts.SVGHeaderStore=artifactFor(compiled,'contracts/core/generated/SVGConstants.sol','SVGHeaderStore');
  const report={compiler,evmVersion:'shanghai',network:'ephemeral local Ganache; no public deployment',contracts:[],sourceHashes,checks:[],sampleGas:{}};
  if(!coreOnly)report.checks.push(...await checkRenderer({compiled,signer}));
  async function deploy(file,name,args=[]){
    const artifact=compiled.contracts[file][name];
    const runtimeBytes=artifact.evm.deployedBytecode.object.length/2;
    assert.ok(runtimeBytes<=24576,`${name} exceeds EIP-170: ${runtimeBytes}`);
    const contract=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).deploy(...args);
    const receipt=await contract.deploymentTransaction().wait();
    deploymentInitcodes[name]=contract.deploymentTransaction().data;
    deployedAddresses[name]=await contract.getAddress();
    artifacts[name]=artifactFor(compiled,file,name);
    report.contracts.push({name,runtimeBytes,deploymentGas:receipt.gasUsed.toString()});
    await writeFile(path.join(root,`output/contracts/${name}.json`),JSON.stringify(artifactFor(compiled,file,name),null,2)+'\n');
    console.log(`${name}: ${runtimeBytes} runtime bytes, ${receipt.gasUsed} deploy gas`);
    return contract;
  }
  const bankManifest=JSON.parse(await readFile(path.join(root,'output/art-bank-manifest.json'),'utf8'));
  const deploymentNonce=Number(await local.request({method:'eth_getTransactionCount',params:[await signer.getAddress(),'pending']}));
  const addresses=[];
  for(const key of layerKeys){
    const spec=bankManifest.find(item=>item.key===key);
    const pageAddresses=[];
    for(const page of spec.pages)pageAddresses.push(await(await deploy('contracts/core/generated/ArtBanks.sol',page.name)).getAddress());
    const bank=await deploy('contracts/core/generated/ArtBanks.sol',spec.name,pageAddresses.length?[pageAddresses]:[]);
    addresses.push(await bank.getAddress());
    assert.equal(Number(await bank.count()),traits[key].length);
    for(let i=0;!coreOnly&&i<traits[key].length;i++){
      assert.equal(await bank.encodedPart(i),'0x'+traits[key][i].data);
      assert.equal(await bank.part(i),traits[key][i].svg);
      assert.equal(await bank.label(i),traits[key][i].name);
      assert.equal(await bank.description(i),traits[key][i].description);
    }
    await assert.rejects(()=>bank.part(traits[key].length));
  }
  report.checks.push(`All ${layerKeys.reduce((total,key)=>total+traits[key].length,0)} on-chain trait fragments, labels and descriptions match source, including every cap-page boundary; out-of-range access reverts.`);
  const encoder=await deploy('contracts/core/MetadataEncoder.sol','MetadataEncoder');
  const genotypeDescriptor=await deploy('contracts/core/GenotypeDescriptor.sol','GenotypeDescriptor',[addresses,await encoder.getAddress()]);
  const phenotype=await deploy('contracts/core/PhenotypeRenderer.sol','PhenotypeRenderer',[await genotypeDescriptor.getAddress()]);
  assert.equal(Number(await genotypeDescriptor.combinations()),combinations);
  const initialRoyaltyReceiver=await (await provider.getSigner(1)).getAddress();
  const token=await deploy('contracts/core/MyceliumFriends.sol','MyceliumFriends',[await genotypeDescriptor.getAddress(),await phenotype.getAddress(),await signer.getAddress(),await signer.getAddress(),combinations,initialRoyaltyReceiver]);
  const plan=deploymentPlan({chainId:Number((await provider.getNetwork()).chainId),treasury:await signer.getAddress(),initialOwner:await signer.getAddress(),saleCap:combinations,royaltyBps:500,royaltyReceiver:initialRoyaltyReceiver});
  report.deploymentVerification=await verifyDeployment({provider,plan,addresses:deployedAddresses,artifacts});
  const boundConfig={...plan.config,kind:'PRODUCTION',deployer:await signer.getAddress(),nonce:deploymentNonce,
    roleCodeHashes:{initialOwner:keccak256('0x'),treasury:keccak256('0x'),royaltyReceiver:keccak256('0x')},
    treasuryProbeWei:'1',gasLimits:Object.fromEntries(plan.steps.map(s=>[s.name,'15000000'])),maxFeePerGas:'2000000000',maxPriorityFeePerGas:'1000000000',balanceBufferWei:'0'};
  const bound=await resolvedDeployment(compiled,deploymentPlan(boundConfig));
  assert.deepEqual(bound.addresses,deployedAddresses,'Predicted CREATE addresses differ from actual local deployment');
  for(const step of bound.steps)assert.equal(step.initcodeHash,keccak256(deploymentInitcodes[step.name]),`${step.name}: resolved initcode differs`);
  for(const step of [...bound.steps,...bound.internalContracts])assert.equal(keccak256(await provider.getCode(step.address)),step.runtimeHash,`${step.name}: immutable-bound runtime hash differs`);
  report.releaseBinding={predictedAddressesMatched:true,resolvedInitcodes:bound.steps.length,boundRuntimeHashes:bound.steps.length+bound.internalContracts.length};
  report.checks.push('Approved-plan CREATE predictions, resolved constructor initcodes and exact immutable-bound runtime hashes match all deployed contracts, including internal SVG headers.');
  await assert.rejects(()=>verifyDeployment({provider,plan:{...plan,config:{...plan.config,royaltyBps:501}},addresses:deployedAddresses,artifacts}),/Wrong royalty rate/);
  report.catalogFingerprint=catalogFingerprint();
  await assert.rejects(()=>verifyDeployment({provider,plan,addresses:{...deployedAddresses,GenotypeDescriptor:deployedAddresses.MyceliumFriends},artifacts}));
  report.checks.push('Fresh runtime/immutable address graph, treasury, collection owner, schedule, sale cap and every birth fragment/label verified; wrong deployment address rejected.');
  report.settlement=await runStage('settlement and refund safety',()=>checkSettlement({compiled,provider,signer,local}));
  report.protection=await runStage('commit/reveal, pause and replay protection',()=>checkProtection({compiled,provider,signer,genotypeDescriptor,phenotype,local}));
  report.coreProtocol=await runStage('core protocol lifecycle and high-budget metadata',()=>checkCoreProtocol({compiled,provider,signer,genotypeDescriptor,phenotype,local}));
  report.royalties=await runStage('royalties, validators and settlement currencies',()=>checkRoyalties({compiled,provider,signer,genotypeDescriptor,phenotype,local}));
  report.allowlist=await runStage('allowlist lifecycle and phase transitions',()=>checkAllowlist({compiled,provider,signer,genotypeDescriptor,phenotype,local}));
  for(const rule of [brushCapOffsets.chanterelle,brushCapOffsets.sleepyHand]){
    const genotype=[0,rule.cap,0,0,brushCapOffsets.accessory,0];
    assert.equal(await genotypeDescriptor.renderSVG(packGenotype(genotype)),renderSVG(genotype));
  }
  report.checks.push('Paint It Green cap-specific offsets match byte-for-byte in JavaScript and EVM.');
  await writeFile(path.join(root,'output/reports/core-protocol.json'),JSON.stringify(report,null,2)+'\n');
  if(coreOnly){
    console.log(`PASS: ${report.coreProtocol.checks.length} core protocol groups.`);
  }else{
  report.mint=await checkMint({compiled,provider,signer,token,genotypeDescriptor,phenotype,local});
  for(const [i,edition] of editions.entries()){
    const genotype=packGenotype(edition.genotype);
    assert.equal(await genotypeDescriptor.renderSVG(genotype),renderSVG(edition.genotype));
    const uri=await genotypeDescriptor.tokenURI(i+1,genotype);
    const expectedMetadata=tokenMetadata(edition.genotype,{tokenId:i+1});
    assert.equal(uri,'data:application/json;base64,'+Buffer.from(JSON.stringify(expectedMetadata)).toString('base64'));
    assert.ok(uri.startsWith('data:application/json;base64,'));
    const metadata=JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString());
    assert.equal(metadata.name,`Mycelium Friend #${i+1}`);
    assert.equal(Buffer.from(metadata.image.split(',')[1],'base64').toString(),renderSVG(edition.genotype));
    assert.deepEqual(metadata.attributes,attributes(edition.genotype));
    console.log(`Verified SVG + tokenURI ${i+1}/${editions.length}: ${edition.name}`);
  }
  report.checks.push(`All ${editions.length} curated SVGs are byte-identical in JS and EVM; all tokenURI JSON, SVG images and attributes decode correctly.`);
  let capChecked=0;
  for(const [capIndex,item] of traits.cap.entries()){
    const genotype=[0,capIndex,0,0,0,0];
    const uri=await genotypeDescriptor.tokenURI(1,packGenotype(genotype));
    const metadata=JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString());
    assert.equal(Buffer.from(metadata.image.split(',')[1],'base64').toString(),renderSVG(genotype));
    assert.deepEqual(metadata.attributes,attributes(genotype));
    capChecked++;if(capChecked%12===0||capChecked===traits.cap.length)console.log(`Verified live caps ${capChecked}/${traits.cap.length}`);
  }
  report.checks.push(`All ${traits.cap.length} live cap compositions and tokenURI attributes match JavaScript.`);
  for(const [stemIndex,item] of traits.stem.entries()){
    const genotype=[stemIndex,traits.cap.findIndex(t=>t.id==='mushroom-cloud'),0,0,0,0];
    const uri=await genotypeDescriptor.tokenURI(1,packGenotype(genotype));
    const metadata=JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString());
    assert.equal(Buffer.from(metadata.image.split(',')[1],'base64').toString(),renderSVG(genotype),item.id);
    assert.deepEqual(metadata.attributes,attributes(genotype));
  }
  report.checks.push(`All ${traits.stem.length} stem materials render with the separated Mushroom Cloud crown; SVG and tokenURI attributes match JavaScript.`);

  for(const n of [0,1,41,500,1729,combinations-1]) assert.equal(await genotypeDescriptor.genotypeForIndex(n),packGenotype(genotypeFromNumber(n)));
  await assert.rejects(()=>genotypeDescriptor.genotypeForIndex(combinations));
  for(let i=0;i<layerKeys.length;i++){
    const bad=BigInt(traits[layerKeys[i]].length)<<BigInt(i*8);
    await assert.rejects(()=>genotypeDescriptor.renderSVG(bad));
    await assert.rejects(()=>genotypeDescriptor.tokenURI(1,bad));
  }
  report.checks.push('Genotype enumeration parity, upper bound and invalid genotypes checked on all six layers.');
  report.sampleGas.renderSVG=(await genotypeDescriptor.renderSVG.estimateGas(packGenotype(editions[0].genotype))).toString();
  assert.ok(BigInt(report.sampleGas.renderSVG)<1_100_000n,'Representative SVG render gas regression');
  report.sampleGas.tokenURI=(await genotypeDescriptor.tokenURI.estimateGas(1,packGenotype(editions[0].genotype))).toString();
  report.totalDeploymentGas=report.contracts.reduce((n,c)=>n+BigInt(c.deploymentGas),0n).toString();
  report.catalog={traitCounts:layerKeys.map(k=>traits[k].length),combinations,editions:editions.length,catalogSource:'collection/catalog/catalog.json',paletteColors:beadPalette.length};
  await writeFile(path.join(root,'output/reports/onchain.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`PASS: ${report.checks.length+report.mint.checks.length+report.coreProtocol.checks.length} check groups. Total deploy gas: ${report.totalDeploymentGas}.`);
  }
}finally{await local.disconnect();}
