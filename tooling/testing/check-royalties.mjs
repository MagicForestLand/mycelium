import {withCommitReveal,withProtectedReceiver} from '../lib/protected-test-client.mjs';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {BrowserProvider,ContractFactory,MaxUint256,ZeroAddress,id as selectorHash} from 'ethers';
import ganache from 'ganache';
import {compileContracts,artifactFor} from '../lib/compile-contracts.mjs';
import {TRAIT_COUNTS,MAX_SUPPLY,traitsForGenotypeIndex} from '../../collection/source/token-id.js';

export async function checkRoyalties({compiled,provider,signer,genotypeDescriptor,phenotype,local}) {
  const checks=[],alice=await signer.getAddress(),buyer=await provider.getSigner(1),bob=await buyer.getAddress();
  const mark=message=>{checks.push(message);console.log('PASS: '+message);};
  const send=async p=>(await p).wait();
  const deploy=async(name,args=[],file='tests/contracts/core/fixtures/RoyaltyFixtures.sol')=>{
    const a=compiled.contracts[file][name];
    const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);
    await c.waitForDeployment();return name==='MyceliumFriends'?withCommitReveal(c,local):c;
  };
  const treasury=await deploy('RoyaltyTreasuryFixture'),receiver=await treasury.getAddress();
  const nftArgs=[await genotypeDescriptor.getAddress(),await phenotype.getAddress(),receiver,alice,32];
  const nft=await deploy('MyceliumFriends',[...nftArgs,receiver],'contracts/core/MyceliumFriends.sol');
  const address=await nft.getAddress();
  await send(nft.startAllowlistSale());await send(nft.openPublicSale());
  assert.equal(await nft.royaltyBps(),500n);
  assert.equal(await nft.MAX_ROYALTY_BPS(),500n);
  assert.equal(await nft.DEFAULT_ROYALTY_BPS(),500n);
  assert.equal(await nft.royaltyReceiver(),receiver);
  assert.equal(await nft.ROYALTY_DENOMINATOR(),10000n);
  for(const id of ['0x01ffc9a7','0x80ac58cd','0x5b5e139f','0x49064906','0x2a55205a'])
    assert.equal(await nft.supportsInterface(id,{gasLimit:30000}),true);
  for(const id of ['0xffffffff','0x780e9d63'])assert.equal(await nft.supportsInterface(id),false);
  const receipt=await nft.deploymentTransaction().wait();
  const event=receipt.logs.map(log=>nft.interface.parseLog(log)).find(log=>log?.name==='RoyaltyConfigured');
  assert.deepEqual(Array.from(event.args),[receiver,500n]);
  const prices=[0n,1n,19n,20n,21n,9999n,10000n,10001n,10n**18n,MaxUint256];
  for(const id of [0n,BigInt(MAX_SUPPLY-1),BigInt(MAX_SUPPLY),MaxUint256])for(const price of prices)
    assert.deepEqual(Array.from(await nft.royaltyInfo(id,price)),[receiver,price*500n/10000n]);
  // Deterministic varied prices/rates catch rounding and full-width multiplication mistakes.
  for(const bps of [0,1,333,499,500]){
    const instance=nft;
    await send(instance.setRoyaltyInfo(receiver,bps));
    let seed=MaxUint256;
    for(let i=0;i<16;i++){
      const price=i===0?MaxUint256:seed=(seed*6364136223846793005n+1442695040888963407n)&MaxUint256;
      const [recipient,amount]=await instance.royaltyInfo(i,price);
      assert.equal(recipient,receiver);assert.equal(amount,price*BigInt(bps)/10000n);assert.ok(amount<=price);
    }
  }
  mark('ERC-2981 discovery, 5% default/ceiling, event, unminted IDs, rounding, 0-500 bps and uint256-max prices.');

  const a=artifactFor(compiled,'contracts/core/MyceliumFriends.sol','MyceliumFriends');
  const factory=new ContractFactory(a.abi,a.bytecode,signer);
  for(const bps of [501n,10000n,10001n,(1n<<96n)-1n]){
    await assert.rejects(()=>nft.setRoyaltyInfo.staticCall(bob,bps),error=>{
      const decoded=nft.interface.parseError(error.data);
      assert.equal(decoded.name,'InvalidRoyaltyBps');assert.equal(decoded.args[0],bps);return true;
    });
  }
  await assert.rejects(()=>send(nft.setRoyaltyInfo(bob,501,{gasLimit:100000})),e=>e.receipt?.status===0);
  assert.equal(await nft.royaltyBps(),500n);assert.equal(await nft.royaltyReceiver(),receiver);
  for(const invalid of [ZeroAddress,address])await assert.rejects(()=>nft.setRoyaltyInfo.staticCall(invalid,0),e=>nft.interface.parseError(e.data).name==='InvalidRoyaltyReceiver');
  const zeroReceiverArgs=[...nftArgs];zeroReceiverArgs[2]=ZeroAddress;
  const tx=await factory.getDeployTransaction(...zeroReceiverArgs,receiver);
  await assert.rejects(()=>provider.call(tx),error=>nft.interface.parseError(error.data).name==='InvalidConfiguration');
  const badRoyaltyReceiver=await factory.getDeployTransaction(...nftArgs,ZeroAddress);
  await assert.rejects(()=>provider.call(badRoyaltyReceiver),e=>nft.interface.parseError(e.data).name==='InvalidRoyaltyReceiver');
  await assert.rejects(()=>nft.connect(buyer).setRoyaltyInfo.staticCall(bob,0),e=>nft.interface.parseError(e.data).name==='OwnableUnauthorizedAccount');
  mark('Hard 500-bps ceiling, atomic rejected updates, nonzero/non-self receiver, constructor validation and owner-only updates.');

  const quote=Array.from(await nft.royaltyInfo(0,10n**18n));
  await send(nft.transferOwnership(bob));
  await assert.rejects(()=>nft.connect(buyer).setRoyaltyInfo.staticCall(bob,100));
  await send(nft.connect(buyer).acceptOwnership());
  await assert.rejects(()=>nft.setRoyaltyInfo.staticCall(alice,100));
  const update=await send(nft.connect(buyer).setRoyaltyInfo(bob,250));
  const royaltyEvent=update.logs.map(log=>nft.interface.parseLog(log)).find(log=>log?.name==='RoyaltyConfigured');
  assert.deepEqual(Array.from(royaltyEvent.args),[bob,250n]);
  assert.deepEqual(Array.from(await nft.royaltyInfo(0,10000)),[bob,250n]);
  assert.equal(await nft.treasury(),receiver);
  await send(nft.connect(buyer).setRoyaltyInfo(receiver,500));
  const source=await deploy('PhenotypeSourceFixture',[],'tests/contracts/core/fixtures/PhaseOneFixtures.sol');
  await send(nft.connect(buyer).setPhenotypeSource(await source.getAddress()));
  assert.deepEqual(Array.from(await nft.royaltyInfo(0,10n**18n)),quote);
  await send(nft.connect(buyer).setPhenotypeSource(ZeroAddress));
  await assert.rejects(()=>nft.connect(buyer).renounceOwnership.staticCall(),e=>nft.interface.parseError(e.data).name==='OwnershipRenunciationDisabled');
  assert.deepEqual(Array.from(await nft.royaltyInfo(0,10n**18n)),quote);
  assert.equal(await nft.owner(),bob);
  for(const name of ['setDefaultRoyalty','setTokenRoyalty','setRoyaltyBps','setTreasury'])assert.equal(nft.interface.getFunction(name),null);
  mark('Receiver rotation leaves mint treasury unchanged; rate can decrease/restore to 5%; two-step owner authority and disabled renunciation checked.');

  await send(nft.mint(...traitsForGenotypeIndex(0)));
  const market=await deploy('RoyaltyMarketFixture'),marketAddress=await market.getAddress();
  await send(nft.approve(marketAddress,1));
  const balance=async account=>BigInt(await local.request({method:'eth_getBalance',params:[account,'latest']}));
  const beforeSeller=await balance(alice),beforeTreasury=await balance(receiver);
  await send(market.connect(buyer).buyETH(address,1,{value:10001n}));
  assert.equal(await balance(receiver)-beforeTreasury,500n);
  assert.equal(await balance(alice)-beforeSeller,9501n);
  assert.equal(await nft.ownerOf(1),bob);assert.equal(await nft.ownershipEpoch(1),2n);
  assert.equal(await balance(address),0n);
  // A gift requires no payment and has no effect on primary mint pricing or royalties.
  const mintPrice=await nft.mintPrice(1);
  await send(nft.connect(buyer)['safeTransferFrom(address,address,uint256)'](bob,alice,1));
  assert.equal(await nft.mintPrice(1),mintPrice);assert.equal(await nft.totalMinted(),1n);
  assert.deepEqual(Array.from(await nft.royaltyInfo(0,10n**18n)),quote);
  await send(nft.approve(marketAddress,1));await send(treasury.setRejecting(true));
  const epoch=await nft.ownershipEpoch(1),sellerBeforeFailure=await balance(alice),treasuryBeforeFailure=await balance(receiver);
  await assert.rejects(()=>send(market.connect(buyer).buyETH(address,1,{value:10001n,gasLimit:300000})),e=>e.receipt?.status===0);
  assert.equal(await nft.ownerOf(1),alice);assert.equal(await nft.ownershipEpoch(1),epoch);
  assert.equal(await nft.getApproved(1),marketAddress);
  assert.equal(await balance(alice),sellerBeforeFailure);assert.equal(await balance(receiver),treasuryBeforeFailure);
  assert.equal(await balance(marketAddress),0n);
  mark('Test ETH settlement pays treasury directly; gifts remain free; rejected payment atomically restores ownership, approval and epoch.');

  const currency=await deploy('RoyaltyCurrencyFixture',[bob]);
  await send(currency.connect(buyer).approve(marketAddress,10001n));
  await send(market.connect(buyer).buyERC20(address,1,await currency.getAddress(),10001n));
  assert.equal(await currency.balanceOf(receiver),500n);assert.equal(await currency.balanceOf(alice),9501n);
  assert.equal(await currency.balanceOf(bob),989999n);assert.equal(await currency.balanceOf(address),0n);
  assert.equal(await nft.ownerOf(1),bob);
  mark('Test ERC-20 settlement pays in the sale currency directly to treasury, without NFT custody or withdrawal.');

  const controlled=await deploy('MyceliumFriends',[...nftArgs,bob],'contracts/core/MyceliumFriends.sol');
  const controlledAddress=await controlled.getAddress();
  await send(controlled.startAllowlistSale());await send(controlled.openPublicSale());
  const creatorId='0x'+['getTransferValidator()','setTransferValidator(address)','getTransferValidationFunction()']
    .reduce((a,s)=>a^BigInt(selectorHash(s).slice(0,10)),0n).toString(16).padStart(8,'0');
  assert.equal(await controlled.supportsInterface(creatorId,{gasLimit:30000}),true);
  assert.deepEqual(Array.from(await controlled.getTransferValidationFunction()),['0xcaee23ea',true]);
  assert.equal(await controlled.getTransferValidator(),ZeroAddress);
  const validator=await deploy('TransferValidatorFixture'),validatorAddress=await validator.getAddress();
  await assert.rejects(()=>controlled.connect(buyer).setTransferValidator.staticCall(validatorAddress));
  for(const invalid of [alice,controlledAddress])await assert.rejects(()=>controlled.setTransferValidator.staticCall(invalid),e=>controlled.interface.parseError(e.data).name==='InvalidTransferValidator');
  const install=await send(controlled.setTransferValidator(validatorAddress));
  assert.deepEqual(Array.from(install.logs.map(l=>controlled.interface.parseLog(l)).find(l=>l?.name==='TransferValidatorUpdated').args),[ZeroAddress,validatorAddress]);
  assert.equal(await validator.tokenTypes(controlledAddress),721n);
  const configure=async(mode,caller=alice,from=alice,to=bob)=>send(validator.configure(mode,caller,from,to,1,1));
  await configure(1);
  // Even a rejecting validator must not block mint; all transfer routes must consult it.
  await send(controlled.mint(...traitsForGenotypeIndex(0)));
  await send(controlled.approve(bob,1));
  for(const method of ['transferFrom','safeTransferFrom(address,address,uint256)','safeTransferFrom(address,address,uint256,bytes)']){
    const args=method.endsWith(',bytes)')?[alice,bob,1,'0x1234']:[alice,bob,1];
    await assert.rejects(()=>send(controlled.connect(buyer)[method](...args,{gasLimit:250000})),e=>e.receipt?.status===0);
    assert.equal(await controlled.ownerOf(1),alice);assert.equal(await controlled.ownershipEpoch(1),1n);
    assert.equal(await controlled.getApproved(1),bob);
  }
  await assert.rejects(()=>controlled.transferFrom.staticCall(alice,alice,1));
  await configure(2,bob);
  await assert.rejects(()=>send(controlled.connect(buyer).transferFrom(alice,bob,1,{gasLimit:250000})),e=>e.receipt?.status===0);
  await configure(0,bob);
  await send(controlled.connect(buyer).transferFrom(alice,bob,1));
  assert.equal(await controlled.ownerOf(1),bob);assert.equal(await controlled.ownershipEpoch(1),2n);
  assert.equal(await controlled.getApproved(1),ZeroAddress);
  assert.equal(await controlled.isApprovedForAll(bob,validatorAddress),false);
  await assert.rejects(()=>validator.move.staticCall(controlledAddress,bob,alice,1));
  await send(controlled.connect(buyer).approve(validatorAddress,1));
  await configure(1);
  await send(validator.move(controlledAddress,bob,alice,1));
  assert.equal(await controlled.ownerOf(1),alice);
  mark('Creator Token discovery/registration, pre-state validation, all transfer routes, STATICCALL, atomic rollback and no automatic validator approval.');

  const legacy=await deploy('LegacyTransferValidatorFixture');
  await send(controlled.setTransferValidator(await legacy.getAddress()));
  await send(controlled['safeTransferFrom(address,address,uint256,bytes)'](alice,bob,1,'0x1234'));
  await send(controlled.setTransferValidator(validatorAddress));
  await send(controlled.setTransferValidator(ZeroAddress));
  await send(controlled.connect(buyer)['safeTransferFrom(address,address,uint256)'](bob,alice,1));
  assert.deepEqual(Array.from(await controlled.royaltyInfo(0,10000)),[bob,500n]);
  assert.equal(await controlled.treasury(),receiver);
  const rotatedReceiver=await (await provider.getSigner(2)).getAddress();
  await send(controlled.setRoyaltyInfo(rotatedReceiver,250));
  await send(controlled.approve(marketAddress,1));
  const beforeRotated=await balance(rotatedReceiver),beforeOriginal=await balance(receiver),beforeSale=await balance(alice);
  await send(market.connect(buyer).buyETH(controlledAddress,1,{value:10001n}));
  assert.equal(await balance(rotatedReceiver)-beforeRotated,250n);
  assert.equal(await balance(alice)-beforeSale,9751n);
  assert.equal(await balance(receiver),beforeOriginal);
  assert.equal(await controlled.treasury(),receiver);
  mark('After recipient/rate rotation, test settlement pays only the new receiver at 2.5%; primary treasury stays unchanged.');
  await send(controlled.transferOwnership(bob));await send(controlled.connect(buyer).acceptOwnership());
  await assert.rejects(()=>controlled.setTransferValidator.staticCall(validatorAddress));
  await send(controlled.connect(buyer).setTransferValidator(await legacy.getAddress()));
  await assert.rejects(()=>controlled.connect(buyer).renounceOwnership.staticCall(),e=>controlled.interface.parseError(e.data).name==='OwnershipRenunciationDisabled');
  await send(controlled.connect(buyer).setTransferValidator(ZeroAddress));
  assert.equal(await controlled.getTransferValidator(),ZeroAddress);
  mark('Legacy validator registration fallback, replacement, disable/recovery, independent royalties and transferred validator authority and retained recovery.');
  return {checks};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const {compiled}=compileContracts();
  const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'}});
  try{
    const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner();
    const deploy=async(file,name,args)=>{
      const a=compiled.contracts[file][name];const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);
      await c.waitForDeployment();return name==='MyceliumFriends'?withCommitReveal(c,local):c;
    };
    const genotypeDescriptor=await deploy('tests/contracts/core/fixtures/MintFixtures.sol','GenotypeCountsMock',[TRAIT_COUNTS,MAX_SUPPLY]);
    const phenotype=await deploy('contracts/core/PhenotypeRenderer.sol','PhenotypeRenderer',[await genotypeDescriptor.getAddress()]);
    await checkRoyalties({compiled,provider,signer,genotypeDescriptor,phenotype,local});
  }finally{await local.disconnect();}
}
