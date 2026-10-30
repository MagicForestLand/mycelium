import {withCommitReveal,withProtectedReceiver} from './protected-test-client.mjs';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {ContractFactory, ZeroAddress, AbiCoder, getCreateAddress} from 'ethers';
import {checkTreasuryReceiving} from './deployment-roles.mjs';
import {traits,layerKeys,renderSVG,packGenotype,attributes} from '../../collection/source/art.js';
import {MAX_SUPPLY,traitsForGenotypeIndex} from '../../collection/source/token-id.js';

export async function checkCoreProtocol({compiled,provider,signer,genotypeDescriptor,phenotype,local}) {
  const report={checks:[],phenotype:[]};
  const alice=await signer.getAddress(), bobSigner=await provider.getSigner(1), bob=await bobSigner.getAddress();
  const agent=await (await provider.getSigner(2)).getAddress();
  const send=async p=>(await p).wait();
  const deploy=async(name,args=[],file='tests/contracts/core/fixtures/PhaseOneFixtures.sol')=>{
    const artifact=compiled.contracts[file][name];
    const instance=await new ContractFactory(artifact.abi,artifact.evm.bytecode.object,signer).deploy(...args);
    await instance.waitForDeployment();return instance;
  };
  const nft=async(cap=32,treasury=alice,open=true)=>{
    const token=await deploy('MyceliumFriends',[await genotypeDescriptor.getAddress(),await phenotype.getAddress(),treasury,alice,cap,treasury],'contracts/core/MyceliumFriends.sol');
    if(open){await send(token.startAllowlistSale());await send(token.openPublicSale());}
    return withCommitReveal(token,local);
  };
  const mark=s=>{report.checks.push(s);console.log('PASS: '+s);};
  const reject=async action=>assert.rejects(action,error=>error.code==='CALL_EXCEPTION');
  const selection=id=>traitsForGenotypeIndex(id);
  const quote=await deploy('PriceHarness');
  const STEP=100_000_000_000_000n;
  for(const [n,price] of [[1,0n],[2,STEP],[100,99n*STEP],[1000,999n*STEP]])assert.equal(await quote.quote(n-1,1),price);
  for(const M of [0n,1n,99n,999n,BigInt(MAX_SUPPLY)-32n,(1n<<48n)-32n]){
    for(const q of [1n,2n,3n,32n]){
      let sum=0n;for(let i=0n;i<q;i++)sum+=(M+i)*STEP;
      assert.equal(await quote.quote(M,q),sum);
    }
  }
  mark('Linear prices P(1/2/100/1000), batch arithmetic and six-byte upper arithmetic bound.');

  const treasury=await deploy('TreasuryFixture');
  const nextNonce=Number(await local.request({method:'eth_getTransactionCount',params:[alice,'pending']}));
  const selfTreasuryAddress=getCreateAddress({from:alice,nonce:nextNonce});
  const nftArtifact=compiled.contracts['contracts/core/MyceliumFriends.sol'].MyceliumFriends;
  const selfTreasuryTx=await new ContractFactory(nftArtifact.abi,nftArtifact.evm.bytecode.object,signer).getDeployTransaction(
    await genotypeDescriptor.getAddress(),await phenotype.getAddress(),selfTreasuryAddress,alice,2,alice);
  // Use an actual local CREATE: Ganache's eth_call creation path does not honor
  // transaction nonce consistently when deriving the new contract address.
  await assert.rejects(()=>send(signer.sendTransaction({...selfTreasuryTx,nonce:nextNonce,gasLimit:4_000_000})),error=>error.receipt?.status===0);
  assert.equal(await provider.getCode(selfTreasuryAddress),'0x');
  const token=await nft(6,await treasury.getAddress());const address=await token.getAddress();
  const probe=async()=>checkTreasuryReceiving({provider,config:{initialOwner:alice,treasury:treasury.target,royaltyReceiver:alice},addresses:{MyceliumFriends:address},
    blockTag:await local.request({method:'eth_blockNumber',params:[]}),amountWei:1n});
  assert.equal((await probe()).treasuryProbe.passed,true);
  await send(treasury.configure(address,true));
  await assert.rejects(probe);
  await send(token.mint(...selection(MAX_SUPPLY-1)));
  await reject(()=>token.mint.staticCall(...selection(504))); // Free bypass after the first mint.
  await reject(()=>token.mint.staticCall(...selection(504),{value:STEP-1n}));
  await send(token.mint(...selection(504),{value:STEP}));
  const stale=await token.mintPrice(1);
  await send(token.connect(bobSigner).mint(...selection(505),{value:stale}));
  await reject(()=>token.mint.staticCall(...selection(506),{value:stale}));
  const receiver=withProtectedReceiver(await deploy('BatchReceiverFixture',[address]),token,local);
  const receiverAddress=await receiver.getAddress();
  const batch=[selection(506),selection(507)], value=await token.mintPrice(2);
  await reject(()=>token.mintBatch.staticCall([]));
  await reject(()=>token.mintBatch.staticCall(Array(33).fill(selection(506))));
  await reject(()=>token.mintBatch.staticCall([selection(506),selection(506)],{value}));
  await reject(()=>token.mintBatch.staticCall([selection(504),selection(506)],{value}));
  await reject(()=>send(receiver.run(batch,2,ZeroAddress,{value,gasLimit:900_000})));
  assert.equal(await token.totalMinted(),3n);assert.equal(await token.ownershipEpoch(4),0n);
  assert.equal(await token.isAvailable(...selection(506)),true);
  await send(receiver.run(batch,0,bob,{value}));
  assert.equal(await receiver.observedMinted(),5n);assert.equal(await receiver.observedEpoch(),1n);
  assert.equal(await receiver.reentryBlocked(),true);assert.equal(await token.ownerOf(4),bob);
  assert.equal(await token.ownershipEpoch(4),2n);
  await send(token.mint(...selection(508),{value:await token.mintPrice(1)}));
  assert.equal(await token.totalSupply(),6n);assert.equal(await token.totalMinted(),6n);
  await reject(()=>token.mint.staticCall(...selection(509),{value:6n*STEP}));
  assert.equal(token.interface.getFunction('burn'),null);
  await reject(()=>token.withdraw.staticCall());
  const rawBalance=async a=>BigInt(await local.request({method:'eth_getBalance',params:[a,'latest']}));
  assert.equal(await rawBalance(address),15n*STEP);
  await send(treasury.configure(address,false));
  await send(token.connect(bobSigner).withdraw());
  assert.equal(await rawBalance(address),0n);assert.equal(await rawBalance(await treasury.getAddress()),15n*STEP);
  assert.equal(await treasury.reentryBlocked(),true);
  mark('Exact payment/stale quotes, independent sale cap, batch atomic rollback, reentrant receiver/retransfer, fixed treasury and rejecting/reentrant withdrawals.');

  const fullBatch=await nft(32);
  await send(fullBatch.mintBatch(Array.from({length:32},(_,i)=>selection(i)),{value:496n*STEP}));
  assert.equal(await fullBatch.totalMinted(),32n);
  const manual=await nft(2,alice,false);
  await reject(()=>manual.mint.staticCall(...selection(0)));
  await send(manual.startAllowlistSale());
  await send(manual.openPublicSale());
  await send(manual.mint(...selection(0),{gasLimit:250_000}));
  mark('Maximum 32-token batch, manual public-sale transition and no-burn chronology.');

  const permission=await deploy('EpochPermissionFixture');
  const original=await token.originalSVG(2);
  assert.equal(original,renderSVG(selection(504)));
  await send(permission.grant(address,2,agent));
  const wallet=await deploy('BoundWalletFixture',[address,2]);
  await send(signer.sendTransaction({to:await wallet.getAddress(),value:12345n}));
  await send(token.approve(bob,2));
  await send(token.connect(bobSigner).transferFrom(alice,bob,2));
  assert.equal(await token.getApproved(2),ZeroAddress);
  assert.equal(await permission.valid(address,2,agent),false);
  assert.equal(await wallet.owner(),bob);assert.equal(await rawBalance(await wallet.getAddress()),12345n);
  await reject(()=>wallet.pay.staticCall(alice,1n));
  await send(token.connect(bobSigner)['safeTransferFrom(address,address,uint256,bytes)'](bob,alice,2,'0x1234'));
  assert.equal(await permission.valid(address,2,agent),false);
  assert.equal(await token.ownershipEpoch(2),3n);
  await send(permission.grant(address,2,agent));
  await send(token.transferFrom(alice,alice,2));
  assert.equal(await permission.valid(address,2,agent),false);
  assert.equal(await token.ownershipEpoch(2),4n);
  await reject(()=>send(token.connect(bobSigner).transferFrom(alice,bob,2,{gasLimit:200_000})));
  assert.equal(await token.ownershipEpoch(2),4n);assert.equal(await token.originalSVG(2),original);
  assert.equal(await token.totalMinted(),6n);
  mark('Third-party approved transfer, both safe-transfer semantics, round-trip/self-transfer epoch invalidation, failed-transfer rollback, originalSVG and bound-wallet asset permanence.');

  const external=await deploy('ExternalNFTFixture'),clone=await deploy('ExternalNFTFixture'),messaging=await deploy('MessagingFixture');
  await send(external.mint(504));await send(clone.mint(504));
  const chainId=(await provider.getNetwork()).chainId;
  const ref=[chainId,address,2], extRef=[chainId,await external.getAddress(),504], fakeRef=[chainId,await clone.getAddress(),504];
  await send(messaging.verify(chainId,address));await send(messaging.verify(chainId,await external.getAddress()));
  await send(messaging.send(ref,extRef));await send(messaging.send(extRef,ref));
  await reject(()=>messaging.send.staticCall(fakeRef,ref));
  await reject(()=>messaging.send.staticCall([chainId+1n,address,504],extRef));
  await send(external.transferFrom(alice,bob,504));
  await reject(()=>messaging.send.staticCall(extRef,ref));
  await send(messaging.connect(bobSigner).send(extRef,ref));
  mark('NFTRef same-chain messaging works both ways with external ERC-721; same-name clone/wrong chain/stale owner rejected without NFT hooks.');

  console.log('RUN: dynamic phenotype metadata · fallback matrix, malformed ABI, maximum overlay at 50M/100M/150M gas');
  const phenotypeNFT=await nft();const phenotypeNFTAddress=await phenotypeNFT.getAddress();
  const heavy=layerKeys.map(key=>traits[key].reduce((best,t,i,all)=>t.svg.length>all[best].svg.length?i:best,0));
  const emptyRefresh=await send(phenotypeNFT.setPhenotypeSource(ZeroAddress));
  assert.ok(!emptyRefresh.logs.some(log=>phenotypeNFT.interface.parseLog(log)?.name==='BatchMetadataUpdate'));
  await send(phenotypeNFT.mint(...heavy));const id=1;
  const baseURI=await phenotypeNFT.tokenURI(id,{gasLimit:50_000_000}),baseSVG=await phenotypeNFT.originalSVG(id);
  assert.equal(baseSVG,renderSVG(heavy),'Production image must match the website layer order');
  const source=await deploy('PhenotypeSourceFixture');
  await reject(()=>phenotypeNFT.connect(bobSigner).setPhenotypeSource.staticCall(awaitAddress(source)));
  await reject(()=>phenotypeNFT.setPhenotypeSource.staticCall(bob));
  const switchReceipt=await send(phenotypeNFT.setPhenotypeSource(await source.getAddress()));
  const refreshEvent=switchReceipt.logs.map(log=>phenotypeNFT.interface.parseLog(log)).find(log=>log?.name==='BatchMetadataUpdate');
  assert.deepEqual(Array.from(refreshEvent.args),[1n,1n]);
  // Full coverage and repeated/overlapping runs are permitted; the base stays accessible.
  const maxRuns=Buffer.from(Array.from({length:192},(_,i)=>[0,i%80,80,255,170,17]).flat());
  for(const [mode,label] of [[1,'revert'],[2,'out of gas'],[3,'oversized returndata'],[4,'wrong ABI offset'],[5,'attempted storage write'],[6,'overflow ABI length'],[7,'truncated ABI']]){
    await send(source.configure(mode,'0x'));
    const uri=await phenotypeNFT.tokenURI(id,{gasLimit:50_000_000});assert.equal(uri,baseURI,label);
    report.phenotype.push({case:label,fallback:true});
  }
  for(const [label,data] of [
    ['empty','0x'],['partial run','0x0102'],['off grid','0x500001ffaa11'],['zero length','0x000000ffaa11'],
    ['over maximum run count',Buffer.from(Array.from({length:193},()=>[0,0,1,255,170,17]).flat())]
  ]){
    await send(source.configure(0,data));assert.equal(await phenotypeNFT.tokenURI(id,{gasLimit:50_000_000}),baseURI,label);
  }
  const codec=AbiCoder.defaultAbiCoder();
  const raw=codec.encode(['bytes','string','uint8','uint8'],['0x000050ffaa11','Hi',0,0]);
  const mutate=(offset,value)=>{const b=Buffer.from(raw.slice(2),'hex');b.set(Buffer.from(BigInt(value).toString(16).padStart(64,'0'),'hex'),offset);return b;};
  for(const malformed of [mutate(0,64),mutate(32,128),mutate(64,256),mutate(128,(1n<<256n)-1n),mutate(192,193),Buffer.from(raw.slice(2,-2),'hex')]){
    await send(source.configure(8,malformed));
    assert.equal(await phenotypeNFT.tokenURI(id,{gasLimit:50_000_000}),baseURI,'malformed appearance ABI');
  }
  await send(source.configureMessage('0x','<script>&"\'\n\u041f\u0440\u0438\u0432\u0435\u0442, \u0433\u0440\u0438\u0431!\n🍄 hello',40,64));
  const escapedURI=await phenotypeNFT.tokenURI(id,{gasLimit:50_000_000});
  const escaped=JSON.parse(Buffer.from(escapedURI.split(',')[1],'base64').toString());
  const escapedSVG=Buffer.from(escaped.image.split(',')[1],'base64').toString();
  assert.equal(escaped.attributes.at(-1).value,'<script>&"\'\n\u041f\u0440\u0438\u0432\u0435\u0442, \u0433\u0440\u0438\u0431!\n🍄 hello');
  assert.ok(escaped.description.endsWith(escaped.attributes.at(-1).value));
  await writeFile('output/reports/appearance-message.svg',escapedSVG);
  await writeFile('output/reports/appearance-original.svg',baseSVG);
  await writeFile('output/reports/appearance-message.json',JSON.stringify(escaped,null,2)+'\n');
  assert.match(escapedSVG,/&lt;script&gt;&amp;&quot;&apos;/);assert.doesNotMatch(escapedSVG,/<script/);
  for(const [text,x,y] of [['x'.repeat(25),0,0],['a\nb\nc\nd',0,0],['Hi',41,0],['Hi',0,65]]){
    await send(source.configureMessage('0x000050ffaa11',text,x,y));
    assert.equal(await phenotypeNFT.tokenURI(id,{gasLimit:50_000_000}),baseURI,'invalid message/position drops the entire layer');
  }
  const maxMessage='🎮'.repeat(24)+'\n'+'界'.repeat(24)+'\n'+'x'.repeat(22);
  assert.equal(Buffer.byteLength(maxMessage),192);
  await send(source.configureMessage(maxRuns,maxMessage,40,64));
  let expectedDynamic;
  for(const gasLimit of [50_000_000,100_000_000,150_000_000]){
    console.log(`RUN: maximum phenotype overlay · gas limit ${gasLimit.toLocaleString('en-US')}`);
    const start=performance.now();const uri=await phenotypeNFT.tokenURI(id,{gasLimit});const elapsedMs=performance.now()-start;
    assert.notEqual(uri,baseURI);if(expectedDynamic)assert.equal(uri,expectedDynamic);expectedDynamic=uri;
    const metadata=JSON.parse(Buffer.from(uri.split(',')[1],'base64').toString());
    assert.deepEqual(metadata.attributes, [...attributes(heavy),{trait_type:"Message",value:maxMessage}]);
    const svg=Buffer.from(metadata.image.split(',')[1],'base64').toString();
    assert.ok(svg.startsWith(baseSVG.slice(0,-10)));assert.ok(svg.endsWith('</g></svg>'));
    assert.doesNotMatch(svg,/<script|<image|<foreignObject|onload|https?:\/\/(?!www.w3.org)/i);
    assert.ok(Buffer.byteLength(svg)<=143360);assert.ok(Buffer.byteLength(uri)<=262144);
    report.phenotype.push({case:'maximum allowed overlay',gasLimit,svgBytes:Buffer.byteLength(svg),uriBytes:Buffer.byteLength(uri),elapsedMs:Math.round(elapsedMs)});
    console.log(`DONE: maximum phenotype overlay · gas limit ${gasLimit.toLocaleString('en-US')} · ${Math.round(elapsedMs)}ms`);
  }
  const maxMetadata=JSON.parse(Buffer.from(expectedDynamic.split(',')[1],'base64').toString());
  await writeFile('output/reports/appearance-max.svg',Buffer.from(maxMetadata.image.split(',')[1],'base64'));
  // A smaller reader budget must either return the same full appearance or fail, never a successful base-only image.
  try { assert.equal(await phenotypeNFT.tokenURI(id,{gasLimit:30_000_000}),expectedDynamic); }
  catch(error){if(error.code!=='CALL_EXCEPTION')throw error;}
  assert.equal(await phenotypeNFT.originalSVG(id),baseSVG);
  const meter=await deploy('MetadataCallMeter');
  const [dynamicGas,uriBytes]=await meter.measure(phenotypeNFTAddress,id,{gasLimit:100_000_000});
  assert.ok(dynamicGas<=50_000_000n,'Dynamic candidate exceeds 50M operating budget');
  report.dynamicGas={used:dynamicGas.toString(),uriBytes:Number(uriBytes),target:30_000_000,operatingBudget:50_000_000,hardCeiling:100_000_000};
  if(dynamicGas>30_000_000n)console.log('REVIEW: maximum overlay candidate exceeds the 30M optimization target.');
  await reject(()=>phenotypeNFT.connect(bobSigner).notifyMetadataUpdate.staticCall(id));
  const notify=await send(source.refresh(phenotypeNFTAddress,id));
  assert.ok(notify.logs.some(log=>log.address.toLowerCase()===phenotypeNFTAddress.toLowerCase()&&phenotypeNFT.interface.parseLog(log)?.name==='MetadataUpdate'));
  await send(phenotypeNFT.transferOwnership(bob));assert.equal(await phenotypeNFT.owner(),alice);
  await send(phenotypeNFT.connect(bobSigner).acceptOwnership());assert.equal(await phenotypeNFT.owner(),bob);
  await reject(()=>phenotypeNFT.setPhenotypeSource.staticCall(ZeroAddress));
  await send(phenotypeNFT.connect(bobSigner).setPhenotypeSource(ZeroAddress));
  assert.equal(await phenotypeNFT.tokenURI(id,{gasLimit:50_000_000}),baseURI);
  mark('Late phenotype-source attachment, full-area overlapping graphics and escaped UTF-8 messages, bounded returndata/OOG/staticcall fallbacks, maximum phenotype size, stable high-budget metadata, native ERC-4906 and two-step collection ownership.');
  const rangeReceipt=await send(fullBatch.setPhenotypeSource(await source.getAddress()));
  const range=rangeReceipt.logs.map(log=>fullBatch.interface.parseLog(log)).find(log=>log?.name==='BatchMetadataUpdate');
  assert.deepEqual(Array.from(range.args),[1n,32n]);
  await reject(()=>phenotypeNFT.connect(bobSigner).renounceOwnership.staticCall());
  return report;
}
// Resolve a contract address without accidentally passing a Promise through an error callback.
const awaitAddress=contract=>contract.target;
