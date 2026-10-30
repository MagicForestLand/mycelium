import {withCommitReveal,withProtectedReceiver} from '../lib/protected-test-client.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {BrowserProvider,ContractFactory,ZeroAddress} from 'ethers';
import ganache from 'ganache';
import {compileContracts} from '../lib/compile-contracts.mjs';
import {TRAIT_COUNTS,MAX_SUPPLY,traitsForGenotypeIndex} from '../../collection/source/token-id.js';
import {mintReceiptForGenotype} from '../../apps/web/src/chain-core.js';

export async function checkAllowlist({compiled,provider,signer,genotypeDescriptor,phenotype,local}) {
  const checks=[],alice=await signer.getAddress(),buyer=await provider.getSigner(1),bob=await buyer.getAddress();
  const outsider=await provider.getSigner(2),out=await outsider.getAddress();
  const send=async p=>(await p).wait();
  const mark=s=>{checks.push(s);console.log('PASS: '+s);};
  const deploy=async(file,name,args=[])=>{const a=compiled.contracts[file][name];const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return name==='MyceliumFriends'?withCommitReveal(c,local):c;};
  const fresh=async(cap=16)=>deploy('contracts/core/MyceliumFriends.sol','MyceliumFriends',[await genotypeDescriptor.getAddress(),await phenotype.getAddress(),alice,alice,cap,alice]);
  const nft=await fresh(),address=await nft.getAddress(),selection=traitsForGenotypeIndex;
  const reject=async(p,name)=>assert.rejects(p,e=>{assert.equal(e.code,'CALL_EXCEPTION');if(name)assert.equal(nft.interface.parseError(e.data)?.name,name);return true;});
  assert.equal(await nft.salePhase(),0n);
  await reject(()=>nft.renounceOwnership.staticCall(),'OwnershipRenunciationDisabled');
  await reject(()=>nft.mint.staticCall(...selection(0)),'InvalidSalePhase');
  for(const action of [()=>nft.openPublicSale.staticCall(),()=>nft.pausePublicSale.staticCall(),()=>nft.resumePublicSale.staticCall()])await reject(action,'InvalidSalePhase');
  for(const action of [()=>nft.connect(buyer).setAllowlistAllocations.staticCall([bob],[1]),()=>nft.connect(buyer).startAllowlistSale.staticCall(),()=>nft.connect(buyer).openPublicSale.staticCall(),()=>nft.connect(buyer).pausePublicSale.staticCall(),()=>nft.connect(buyer).resumePublicSale.staticCall()])await reject(action,'OwnableUnauthorizedAccount');
  for(const [wallets,quotas] of [[[],[]],[[ZeroAddress],[1]],[[alice],[]],[[alice],[17]],[Array(257).fill(alice),Array(257).fill(1)]])
    await reject(()=>nft.setAllowlistAllocations.staticCall(wallets,quotas),'InvalidConfiguration');
  await send(nft.setAllowlistAllocations([alice,bob],[4,2]));
  await reject(()=>nft.mint.staticCall(...selection(0)),'InvalidSalePhase');
  const allowlistReceipt=await send(nft.startAllowlistSale());assert.equal(await nft.salePhase(),1n);
  assert.equal(nft.interface.parseLog(allowlistReceipt.logs.find(log=>log.address.toLowerCase()===address.toLowerCase())).name,'AllowlistSaleOpened');
  for(const action of [()=>nft.startAllowlistSale.staticCall(),()=>nft.pausePublicSale.staticCall(),()=>nft.resumePublicSale.staticCall()])await reject(action,'InvalidSalePhase');
  await send(nft.mint(...selection(0)));
  assert.equal(await nft.allowlistClaimed(alice),1n);
  await send(nft.transferFrom(alice,bob,1));
  assert.equal(await nft.allowlistClaimed(alice),1n);assert.equal(await nft.allowlistClaimed(bob),0n);
  assert.equal(await nft.mintPrice(2),0n);
  await reject(()=>nft.mint.staticCall(...selection(1),{value:1n}),'IncorrectPayment');
  await send(nft.mintBatch([selection(1),selection(2)]));
  assert.equal(await nft.mintPrice(1),0n);assert.equal(await nft.publicMinted(),0n);
  await reject(()=>nft.mintBatch.staticCall([selection(9),selection(10)]),'AllowlistAllocationExceeded');
  await send(nft.setAllowlistAllocations([alice],[0]));
  await reject(()=>nft.mint.staticCall(...selection(9)),'AllowlistAllocationExceeded');
  await send(nft.setAllowlistAllocations([alice],[4]));assert.equal(await nft.allowlistClaimed(alice),3n);
  await reject(()=>nft.connect(outsider).mint.staticCall(...selection(9)),'AllowlistAllocationExceeded');
  await send(nft.connect(buyer).mint(...selection(3)));
  mark('Allowlist phase is permanently free; owner-only quotas, exact zero payment, lifetime limits, revocation and no quota reset on transfer.');

  const receiver=await deploy('tests/contracts/core/fixtures/PhaseOneFixtures.sol','BatchReceiverFixture',[address]);
  const receiverAddress=await receiver.getAddress();await send(nft.setAllowlistAllocations([receiverAddress],[2]));
  await assert.rejects(()=>send(receiver.run([selection(4),selection(5)],2,ZeroAddress,{gasLimit:900000})),e=>e.receipt?.status===0);
  assert.equal(await nft.allowlistClaimed(receiverAddress),0n);assert.equal(await nft.totalMinted(),4n);
  assert.equal(await nft.ownershipEpoch(5),0n);assert.equal(await nft.isAvailable(...selection(4)),true);
  await send(receiver.run([selection(4),selection(5)],0,alice));
  assert.equal(await nft.allowlistClaimed(receiverAddress),2n);assert.equal(await receiver.reentryBlocked(),true);
  assert.equal(await nft.totalMinted(),6n);assert.equal(await nft.allowlistMinted(),6n);
  const publicReceipt=await send(nft.openPublicSale());assert.equal(await nft.salePhase(),2n);
  assert.equal(nft.interface.parseLog(publicReceipt.logs.find(log=>log.address.toLowerCase()===address.toLowerCase())).name,'PublicSaleOpened');
  assert.equal(await nft.mintPrice(1),0n);
  for(const action of [()=>nft.openPublicSale.staticCall(),()=>nft.setAllowlistAllocations.staticCall([out],[1])])await reject(action,'InvalidSalePhase');
  for(const action of [()=>nft.startAllowlistSale.staticCall(),()=>nft.resumePublicSale.staticCall()])await reject(action,'InvalidSalePhase');
  await send(nft.connect(outsider).mint(...selection(6)));
  const STEP=100_000_000_000_000n;
  assert.equal(await nft.mintPrice(1),STEP);assert.equal(await nft.mintPrice(2),3n*STEP);
  await send(nft.connect(buyer).mintBatch([selection(7),selection(8)],{value:3n*STEP}));
  assert.equal(await nft.publicMinted(),3n);assert.equal(await nft.allowlistMinted(),6n);assert.equal(await nft.totalMinted(),9n);
  assert.equal(await nft.totalSupply(),9n);assert.equal(await nft.mintPrice(1),3n*STEP);
  assert.equal(await nft.allowlistClaimed(out),0n);
  mark('Allowlist batch rollback/reentrancy and irreversible public transition; public curve starts at zero independently of six allowlist mints.');

  const full=await fresh(2);await send(full.setAllowlistAllocations([alice],[2]));await send(full.startAllowlistSale());
  await send(full.mintBatch([selection(0),selection(1)]));await send(full.openPublicSale());
  await reject(()=>full.mint.staticCall(...selection(2)),'SoldOut');
  const manual=await fresh(2);
  await send(manual.setAllowlistAllocations([alice],[1]));await send(manual.startAllowlistSale());await send(manual.mint(...selection(0)));
  assert.equal(await manual.salePhase(),1n);
  await send(manual.openPublicSale({gasLimit:150000}));assert.equal(await manual.salePhase(),2n);
  const beforePausePrice=await manual.mintPrice(1),beforePausePublic=await manual.publicMinted();
  const pauseReceipt=await send(manual.pausePublicSale());assert.equal(await manual.salePhase(),3n);
  assert.ok(pauseReceipt.logs.some(log=>{try{return manual.interface.parseLog(log)?.name==='PublicSalePaused';}catch{return false;}}));
  await reject(()=>manual.commit.staticCall('0x'+'11'.repeat(32)),'PublicSaleNotOpen');
  for(const action of [()=>manual.mint.staticCall(...selection(1)),()=>manual.mintBatch.staticCall([selection(1)]),()=>manual.pausePublicSale.staticCall(),()=>manual.startAllowlistSale.staticCall()])await reject(action,'InvalidSalePhase');
  await reject(()=>manual.openPublicSale.staticCall(),'InvalidSalePhase');
  await reject(()=>manual.setAllowlistAllocations.staticCall([out],[1]),'InvalidSalePhase');
  assert.equal(await manual.mintPrice(1),beforePausePrice);assert.equal(await manual.publicMinted(),beforePausePublic);
  const resumeReceipt=await send(manual.resumePublicSale());assert.equal(await manual.salePhase(),2n);
  assert.ok(resumeReceipt.logs.some(log=>{try{return manual.interface.parseLog(log)?.name==='PublicSaleResumed';}catch{return false;}}));
  await send(manual.connect(buyer).mint(...selection(1)));
  assert.equal(await manual.publicMinted(),1n);assert.equal(await manual.totalMinted(),2n);
  mark('Shared sale cap, manual owner-only public opening with no timestamp dependency, and guarded ownership renunciation.');
  await reject(()=>manual.renounceOwnership.staticCall(),'OwnershipRenunciationDisabled');
  const race=await fresh(2);
  await send(race.setAllowlistAllocations([alice,bob],[1,1]));await send(race.startAllowlistSale());
  const quotedId=await race.totalMinted()+1n,price=await race.mintPrice(1);
  await send(race.connect(buyer).mint(...selection(0),{value:price}));
  const receipt=await send(race.mint(...selection(1),{value:price}));
  const actual=mintReceiptForGenotype(receipt,await race.getAddress(),alice,selection(1));
  assert.equal(quotedId,1n);assert.equal(actual,2n);assert.equal(await race.ownerOf(actual),alice);
  mark('Concurrent free allowlist mint resolves its actual sequential ID and assigned genotype from the successful receipt.');
  return {checks};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const {compiled}=compileContracts();const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'}});
  try{
    const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
    const deploy=async(file,name,args)=>{const a=compiled.contracts[file][name];const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return name==='MyceliumFriends'?withCommitReveal(c,local):c;};
    const genotypeDescriptor=await deploy('tests/contracts/core/fixtures/MintFixtures.sol','GenotypeCountsMock',[TRAIT_COUNTS,MAX_SUPPLY]);
    const phenotype=await deploy('contracts/core/PhenotypeRenderer.sol','PhenotypeRenderer',[await genotypeDescriptor.getAddress()]);
    await checkAllowlist({compiled,provider,signer,genotypeDescriptor,phenotype,local});
  }finally{await local.disconnect();}
}
