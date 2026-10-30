import {verifyMintProtocol,verifyMintProtocolConstants} from './mint-protocol.mjs';
import assert from 'node:assert/strict';
import {Contract,ZeroAddress,getAddress,keccak256} from 'ethers';
import {layerKeys,traits} from '../../collection/source/art.js';
import {verifyHeaderStore} from './verify-header.mjs';
import {collectionMetadata} from './generate-metadata.mjs';
import {validateRoleAddresses} from './deployment-roles.mjs';
// Read-only verification against a freshly compiled, local deployment plan.
// Mask compiler-declared immutable slots, then verify every address/parameter getter.
export async function verifyDeployment({provider,plan,addresses,artifacts}){
  validateRoleAddresses(plan.config,addresses);
  assert.equal((await provider.getNetwork()).chainId,BigInt(plan.config.chainId),'Wrong deployment chain');
  const instances={};
  for(const step of plan.steps){
    const artifact=artifacts[step.name],address=addresses[step.name];
    assert.ok(address,`Missing address: ${step.name}`);
    const code=await provider.getCode(address);
    const actual=Buffer.from(code.slice(2),'hex'),expected=Buffer.from(artifact.deployedBytecode.slice(2),'hex');
    assert.equal(actual.length,expected.length,`${step.name}: runtime length mismatch`);
    for(const slots of Object.values(artifact.immutableReferences||{}))for(const {start,length} of slots){actual.fill(0,start,start+length);expected.fill(0,start,start+length);}
    assert.deepEqual(actual,expected,`${step.name}: runtime code mismatch`);
    instances[step.name]=new Contract(address,artifact.abi,provider);
  }
  for(const [layer,bank] of plan.banks.entries()){
    const instance=instances[bank.name];assert.equal(await instance.count(),BigInt(traits[layerKeys[layer]].length));
    for(const [i,page] of bank.pages.entries())assert.equal((await instance[`page${i}`]()).toLowerCase(),addresses[page.name].toLowerCase(),`${bank.name}: wrong page ${i}`);
    for(let index=0;index<bank.count;index++){
      const trait=traits[layerKeys[layer]][index];
      assert.equal(await instance.encodedPart(index),'0x'+trait.data,`${bank.name}: wrong birth art ${index}`);
      assert.equal(await instance.label(index),trait.name,`${bank.name}: wrong label ${index}`);
      assert.equal(await instance.description(index),trait.description,`${bank.name}: wrong description ${index}`);
    }
    assert.equal((await instances.GenotypeDescriptor.banks(layer)).toLowerCase(),addresses[bank.name].toLowerCase());
    assert.equal(await instances.GenotypeDescriptor.traitCounts(layer),BigInt(bank.count));
  }
  const nft=instances.MyceliumFriends,genotypeDescriptor=instances.GenotypeDescriptor;
  await verifyMintProtocol(nft);
  assert.equal(await nft.contractURI(),'data:application/json;base64,'+Buffer.from(JSON.stringify(collectionMetadata())).toString('base64'),'Collection metadata mismatch');
  const headerPages=await verifyHeaderStore({provider,address:await genotypeDescriptor.headerStore(),artifact:artifacts.SVGHeaderStore});
  assert.equal((await genotypeDescriptor.encoder()).toLowerCase(),addresses.MetadataEncoder.toLowerCase());
  assert.equal((await instances.PhenotypeRenderer.genotypeDescriptor()).toLowerCase(),addresses.GenotypeDescriptor.toLowerCase());
  assert.equal((await nft.genotypeDescriptor()).toLowerCase(),addresses.GenotypeDescriptor.toLowerCase());
  assert.equal((await nft.phenotypeRenderer()).toLowerCase(),addresses.PhenotypeRenderer.toLowerCase());
  assert.equal((await nft.treasury()).toLowerCase(),plan.config.treasury.toLowerCase());
  assert.equal(await nft.supportsInterface('0x2a55205a'),true,'Missing ERC-2981');
  assert.equal(await nft.supportsInterface('0xad0d7f6c'),true,'Missing Creator Token interface');
  assert.equal(await nft.royaltyBps(),BigInt(plan.config.royaltyBps),'Wrong royalty rate');
  assert.equal(await nft.ROYALTY_DENOMINATOR(),10000n);
  assert.equal(await nft.DEFAULT_ROYALTY_BPS(),500n);
  assert.equal(await nft.MAX_ROYALTY_BPS(),500n);
  assert.equal((await nft.royaltyReceiver()).toLowerCase(),plan.config.royaltyReceiver.toLowerCase(),'Wrong royalty receiver');
  assert.equal(await nft.getTransferValidator(),ZeroAddress,'Launch validator must be explicitly configured after verification');
  assert.deepEqual(Array.from(await nft.getTransferValidationFunction()),['0xcaee23ea',true]);
  const [royaltyReceiver,royaltyAmount]=await nft.royaltyInfo(0,10000n);
  assert.equal(royaltyReceiver.toLowerCase(),plan.config.royaltyReceiver.toLowerCase(),'Wrong royalty receiver');
  assert.equal(royaltyAmount,BigInt(plan.config.royaltyBps),'Wrong royalty quote');
  assert.equal((await nft.owner()).toLowerCase(),plan.config.initialOwner.toLowerCase());
  assert.equal(await nft.pendingOwner(),ZeroAddress);
  assert.equal(await nft.saleCap(),BigInt(plan.config.saleCap));
  assert.equal(await nft.MAX_SUPPLY(),BigInt(plan.banks.reduce((n,b)=>n*b.count,1)));
  assert.equal(await genotypeDescriptor.combinations(),await nft.MAX_SUPPLY());
  assert.equal(await nft.phenotypeSource(),ZeroAddress,'Launch must not depend on future modules');
  assert.equal(await nft.totalMinted(),0n,'Pre-mint verification requires an untouched deployment');
  assert.equal(await nft.salePhase(),0n,'Launch must start fully paused');
  assert.equal(await nft.salePhase(),0n,'Minting must be paused at deployment');
  assert.equal(await nft.publicMinted(),0n);
  assert.equal(await nft.allowlistMinted(),0n);
  return {verified:true,chainId:plan.config.chainId,contracts:plan.steps.length,internalHeaderContracts:headerPages+1,birthTraits:plan.banks.reduce((n,b)=>n+b.count,0)};
}

// Read-only operational health after ownership, sale phase and supply have legitimately changed.
// This deliberately does not replace or weaken verifyDeployment's untouched launch checks.
export async function verifyLiveDeployment({provider,manifest,artifact}){
  assert.equal((await provider.getNetwork()).chainId,1n,'Live health requires Ethereum mainnet');
  for(const item of [...manifest.steps,...manifest.internalContracts]){
    const code=await provider.getCode(item.address);assert.notEqual(code,'0x',`${item.name}: live code missing`);
    assert.equal(keccak256(code),item.runtimeHash,`${item.name}: live runtime hash mismatch`);
  }
  const nft=new Contract(manifest.addresses.MyceliumFriends,artifact.abi,provider);
  await verifyMintProtocolConstants(nft);
  assert.equal(getAddress(await nft.treasury()),getAddress(manifest.config.treasury),'Live immutable treasury changed');
  assert.equal(getAddress(await nft.genotypeDescriptor()),getAddress(manifest.addresses.GenotypeDescriptor),'Live genotype descriptor changed');
  assert.equal(getAddress(await nft.phenotypeRenderer()),getAddress(manifest.addresses.PhenotypeRenderer),'Live phenotype renderer changed');
  assert.equal(await nft.saleCap(),BigInt(manifest.config.saleCap),'Live sale cap changed');
  assert.equal(await nft.MAX_SUPPLY(),BigInt(manifest.catalog.genotypeSpace),'Live catalog supply changed');
  const owner=getAddress(await nft.owner());assert.notEqual(owner,ZeroAddress,'Live owner is zero');
  const pendingOwner=getAddress(await nft.pendingOwner()),salePhase=Number(await nft.salePhase());
  assert.ok(Number.isInteger(salePhase)&&salePhase>=0&&salePhase<=3,'Invalid live sale phase');
  const totalMinted=await nft.totalMinted(),totalSupply=await nft.totalSupply(),allowlistMinted=await nft.allowlistMinted(),publicMinted=await nft.publicMinted();
  assert.equal(totalSupply,totalMinted,'Live total supply/counter mismatch');
  assert.equal(allowlistMinted+publicMinted,totalMinted,'Live phase counters do not sum to total minted');
  assert.ok(totalMinted<=BigInt(manifest.config.saleCap),'Live mint count exceeds sale cap');
  const royaltyReceiver=getAddress(await nft.royaltyReceiver()),royaltyBps=await nft.royaltyBps();
  assert.notEqual(royaltyReceiver,ZeroAddress,'Live royalty receiver is zero');assert.notEqual(royaltyReceiver,getAddress(nft.target),'Collection cannot be its own royalty receiver');
  assert.ok(royaltyBps<=500n,'Live royalty rate exceeds permanent ceiling');
  const validator=getAddress(await nft.getTransferValidator()),phenotypeSource=getAddress(await nft.phenotypeSource());
  for(const [name,address] of [['validator',validator],['phenotype source',phenotypeSource]])if(address!==ZeroAddress){
    assert.notEqual(address,getAddress(nft.target),`Live ${name} points to the collection`);assert.notEqual(await provider.getCode(address),'0x',`Live ${name} has no code`);
  }
  return {verified:true,mode:'LIVE_HEALTH_NOT_UNTOUCHED_DEPLOYMENT',chainId:1,address:getAddress(nft.target),owner,pendingOwner,salePhase,
    totalMinted:totalMinted.toString(),allowlistMinted:allowlistMinted.toString(),publicMinted:publicMinted.toString(),
    royaltyReceiver,royaltyBps:royaltyBps.toString(),validator,phenotypeSource,runtimeContracts:manifest.steps.length+manifest.internalContracts.length};
}
