import {withCommitReveal,withProtectedReceiver} from './protected-test-client.mjs';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {ContractFactory, MaxUint256, ZeroAddress} from 'ethers';
import {attributes, editions, renderSVG, traits, layerKeys,packGenotype} from '../../collection/source/art.js';
import {TRAIT_COUNTS, MAX_SUPPLY} from '../../collection/source/token-id.js';

// Called by check-chain.mjs using the same compiled contracts and local EVM.
export async function checkMint({compiled, provider, signer, token, genotypeDescriptor, phenotype, local}) {
  token=withCommitReveal(token,local);
  const report = {checks: [], mintGas: {}, tokenURIs: [], baseTokenURIDiagnostics: []};
  const address = await token.getAddress();
  const alice = await signer.getAddress();
  const bobSigner = await provider.getSigner(1);
  const bob = await bobSigner.getAddress();
  const operator = await provider.getSigner(2);
  const operatorAddress = await operator.getAddress();
  const mark = message => { report.checks.push(message); console.log(`PASS: ${message}`); };
  const send = async promise => (await promise).wait();
  const expectError = async (action, name, args, contract = token) => {
    await assert.rejects(action, error => {
      assert.equal(error.code, 'CALL_EXCEPTION');
      const decoded = contract.interface.parseError(error.data);
      assert.equal(decoded?.name, name);
      if (args) assert.deepEqual(Array.from(decoded.args), args);
      return true;
    });
  };
  const fixture = async (name, args = []) => {
    const artifact = compiled.contracts['tests/contracts/core/fixtures/MintFixtures.sol'][name];
    const instance = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args);
    await instance.waitForDeployment();
    return instance;
  };

  assert.equal(await token.name(), 'Mycelium Friends');
  assert.equal(await token.symbol(), 'MYFRIENDS');
  assert.equal(await token.genotypeDescriptor(), await genotypeDescriptor.getAddress());
  assert.equal(await token.MAX_SUPPLY(), BigInt(MAX_SUPPLY));
  assert.equal(await token.totalSupply(), 0n);
  await send(token.startAllowlistSale());await send(token.openPublicSale());
  for (const id of ['0x01ffc9a7', '0x80ac58cd', '0x5b5e139f', '0x49064906', '0x2a55205a']) assert.equal(await token.supportsInterface(id), true);
  for (const id of ['0xffffffff', '0x780e9d63']) assert.equal(await token.supportsInterface(id), false);
  const layout = compiled.contracts['contracts/core/MyceliumFriends.sol'].MyceliumFriends.storageLayout.storage;
  assert.ok(layout.some(item=>item.label==='ownershipEpoch'));
  assert.ok(layout.some(item=>item.label==='_genotypeOf'));
  assert.ok(layout.some(item=>item.label==='tokenForGenotype'));
  assert.ok(!layout.some(item=>/tokenURI/i.test(item.label)));
  assert.equal(await token.totalMinted(),0n);
  mark('ERC-165, ERC-721 and metadata interfaces; sequential IDs keep compact DNA and uniqueness indexes without stored token URIs.');

  const verifier = await fixture('CombinationAssertions');
  for (const start of [0,256,512,768,MAX_SUPPLY-512,MAX_SUPPLY-256]) {
    await verifier.verifyRange(address, start, Math.min(start + 256, MAX_SUPPLY), {gasLimit: 25_000_000});
  }
  mark('1536 boundary IDs round-trip in the EVM and match genotypeDescriptor enumeration; additional sampled catalog-index coverage is in the JS suite.');
  for (let layer = 0; layer < TRAIT_COUNTS.length; layer++) {
    for (let value = 0; value < TRAIT_COUNTS[layer]; value++) {
      const values = TRAIT_COUNTS.map(()=>0); values[layer] = value;
      assert.equal(await token.genotypeForTraits(...values), packGenotype(values));
      assert.equal(await token.tokenForTraits(...values),0n);
      assert.equal(await token.isAvailable(...values), true);
    }
    for (const invalid of new Set([BigInt(TRAIT_COUNTS[layer]), 256n, MaxUint256])) {
      const values = TRAIT_COUNTS.map(()=>0n); values[layer] = invalid;
      for (const method of ['genotypeForTraits', 'isAvailable', 'mint']) {
        await expectError(() => token[method].staticCall(...values), 'InvalidTrait', [BigInt(layer), invalid]);
      }
    }
  }
  for (const id of [0n,1n,BigInt(MAX_SUPPLY),MaxUint256]) {
    await expectError(() => token.traitsForTokenId(id), 'ERC721NonexistentToken', [id]);
    await expectError(() => token.tokenURI(id), 'ERC721NonexistentToken', [id]);
    await expectError(() => token.ownerOf(id), 'ERC721NonexistentToken', [id]);
  }
  mark('Every valid trait index, packed DNA parity, all six upper bounds, uint8/uint256 extremes and nonexistent sequential token reads checked.');

  const tokenArtifact = compiled.contracts['contracts/core/MyceliumFriends.sol'].MyceliumFriends;
  const factory = new ContractFactory(tokenArtifact.abi, tokenArtifact.evm.bytecode.object, signer);
  const invalidDescriptor = async candidate => {
    const transaction = await factory.getDeployTransaction(candidate, await phenotype.getAddress(), alice, alice, MAX_SUPPLY, alice);
    await expectError(() => provider.call(transaction), 'InvalidGenotypeDescriptor', []);
  };
  await invalidDescriptor(ZeroAddress);
  await invalidDescriptor(alice);
  await invalidDescriptor(await (await fixture('GenotypeCountsMock', [TRAIT_COUNTS, MAX_SUPPLY-1])).getAddress());
  for (let layer = 0; layer < TRAIT_COUNTS.length; layer++) {
    const counts = [...TRAIT_COUNTS]; counts[layer]++;
    await invalidDescriptor(await (await fixture('GenotypeCountsMock', [counts, MAX_SUPPLY])).getAddress());
  }
  mark('Constructor rejects missing genotypeDescriptor code, wrong combination count and each mismatched trait count.');

  let expectedSupply = 0n;
  async function mint(values, minter = token, gasLabel) {
    const id = expectedSupply+1n;
    assert.equal(await minter.isAvailable(...values), true);
    const value=await token.mintPrice(1);
    assert.equal(await minter.mint.staticCall(...values,{value}), id);
    const receipt = await send(minter.mint(...values,{value}));
    expectedSupply++;
    assert.equal(await token.totalSupply(), expectedSupply);
    assert.equal(await minter.isAvailable(...values), false);
    assert.equal(await token.ownerOf(id), await minter.runner.getAddress());
    assert.equal(await token.tokenForTraits(...values),id);
    assert.equal(await token.genotypeOf(id),packGenotype(values));
    assert.deepEqual(Array.from(await token.traitsForTokenId(id),Number),values);
    const transfer = receipt.logs.map(log => token.interface.parseLog(log)).find(log => log?.name === 'Transfer');
    assert.deepEqual(Array.from(transfer.args), [ZeroAddress, await minter.runner.getAddress(), id]);
    if (gasLabel) report.mintGas[gasLabel] = receipt.gasUsed.toString();
    return id;
  }
  const sample = seed => TRAIT_COUNTS.map((count,layer)=>(seed+layer)%count);
  const first = sample(1);
  const firstId = await mint(first, token, 'firstCollectionMint');
  await mint(sample(2), token, 'subsequentMintExistingHolder');
  await mint(sample(3), token.connect(bobSigner), 'subsequentMintNewHolder');
  for (let mask = 0; mask < 64; mask++) {
    const values = TRAIT_COUNTS.map((count, layer) => mask & (1 << layer) ? count - 1 : 0);
    await mint(values);
  }
  mark('All 64 min/max trait corners mint successfully, including first and last IDs; Transfer events and supply verified.');

  for (const minter of [token, token.connect(bobSigner)]) {
    await expectError(() => minter.mint.staticCall(...first), 'CombinationAlreadyMinted', [firstId]);
  }
  // Bypass estimateGas to verify an actual reverted transaction and state rollback.
  await assert.rejects(() => send(token.connect(bobSigner).mint(...first, {gasLimit: 200_000})), error => {
    assert.equal(error.code, 'CALL_EXCEPTION');
    assert.equal(error.receipt.status, 0);
    return true;
  });
  assert.equal(await token.totalSupply(), expectedSupply);
  assert.equal(await token.ownerOf(firstId), alice);
  await expectError(() => token.connect(bobSigner).transferFrom.staticCall(alice, bob, firstId), 'ERC721InsufficientApproval', [bob, firstId]);
  await send(token.approve(bob, firstId));
  await send(token.connect(bobSigner).transferFrom(alice, bob, firstId));
  assert.equal(await token.getApproved(firstId), ZeroAddress);
  assert.equal(await token.ownerOf(firstId), bob);
  assert.equal(await token.isAvailable(...first), false);
  await expectError(() => token.mint.staticCall(...first), 'CombinationAlreadyMinted', [firstId]);
  await send(token.connect(bobSigner).setApprovalForAll(operatorAddress, true));
  await send(token.connect(operator)['safeTransferFrom(address,address,uint256)'](bob, alice, firstId));
  await expectError(() => token.transferFrom.staticCall(alice, ZeroAddress, firstId), 'ERC721InvalidReceiver', [ZeroAddress]);
  assert.equal(await token.totalSupply(), expectedSupply);
  const paymentProbe=sample(4);
  await expectError(() => token.mint.staticCall(...paymentProbe, {value: 1n}), 'PriceAboveMaximum', [await token.mintPrice(1),1n]);
  assert.equal(token.interface.getFunction('burn'), null);
  mark('Duplicate mint reverts for either wallet and after transfers; approvals, operators, safe transfers and exact-value paid mint checked.');

  const receiver = withProtectedReceiver(await fixture('MintReceiver', [address]),token,local,'single');
  const nonReceiver = withProtectedReceiver(await fixture('NonReceiver'),token,local,'nonreceiver');
  const receiverAddress = await receiver.getAddress();
  for (const mode of [0, 3]) {
    const values = [mode, 1, 1, 1, 1, 1];
    await send(receiver.mint(...values, mode, {value:await token.mintPrice(1)}));
    expectedSupply++;
    assert.equal(await token.ownerOf(await token.tokenForTraits(...values)), receiverAddress);
    assert.equal(await receiver.observedSupply(), expectedSupply);
    assert.equal(await token.totalSupply(), expectedSupply);
  }
  assert.equal(await receiver.duplicateBlocked(), true);
  const rejected = [4, 1, 1, 1, 1, 1];
  await expectError(() => receiver.mint.staticCall(...rejected, 1, {value:expectedSupply*100_000_000_000_000n}), 'Rejected', [], receiver);
  await expectError(() => receiver.mint.staticCall(...rejected, 2, {value:expectedSupply*100_000_000_000_000n}), 'ERC721InvalidReceiver', [receiverAddress]);
  await expectError(() => nonReceiver.mint.staticCall(address, ...rejected, {value:expectedSupply*100_000_000_000_000n}), 'ERC721InvalidReceiver', [await nonReceiver.getAddress()]);
  for (const mode of [1, 2]) {
    await assert.rejects(() => send(receiver.mint(...rejected, mode, {gasLimit: 300_000,value:expectedSupply*100_000_000_000_000n})), error => error.code === 'CALL_EXCEPTION' && error.receipt.status === 0);
  }
  assert.equal(await token.totalSupply(), expectedSupply);
  assert.equal(await token.balanceOf(receiverAddress), 2n);
  assert.equal(await token.isAvailable(...rejected), true);
  await mint(rejected);
  mark('Safe mint accepts ERC721 receivers, rolls back rejected callbacks and blocks same-combination reentrancy.');

  const lifestyleIDs=new Set();
  for(let mask=0;mask<8;mask++){
    const values=[0,0,0,mask&1?1:0,mask&2?1:0,mask&4?1:0];
    if(await token.isAvailable(...values))await mint(values);
    const id=await token.tokenForTraits(...values);lifestyleIDs.add(id.toString());
    await expectError(()=>token.mint.staticCall(...values),'CombinationAlreadyMinted',[id]);
  }
  assert.equal(lifestyleIDs.size,8);
  mark('Glasses, decoration and hobby combinations mint independently and each blocks duplicates.');

  // Include the largest SVG by byte length, not a claimed worst-case gas bound.
  const largestSVG = layerKeys.map(key => traits[key].reduce((best, trait, i, all) =>
    trait.svg.length > all[best].svg.length ? i : best, 0));
  const samples = [TRAIT_COUNTS.map(()=>0), TRAIT_COUNTS.map(n=>n-1), editions[0].genotype, editions[1].genotype, editions[Math.min(15,editions.length-1)].genotype, editions.at(-1).genotype, largestSVG];
  for (const values of samples) {
    if (await token.isAvailable(...values)) await mint(values);
    const id = await token.tokenForTraits(...values);
    const callStarted = performance.now();
    const uri = await token.tokenURI(id, {gasLimit: 50_000_000});
    const callMs = performance.now() - callStarted;
    assert.ok(uri.startsWith('data:application/json;base64,'));
    const metadata = JSON.parse(Buffer.from(uri.split(',')[1], 'base64').toString());
    assert.equal(metadata.name, `Mycelium Friend #${id}`);
    assert.deepEqual(metadata.attributes, attributes(values));
    assert.ok(metadata.image.startsWith('data:image/svg+xml;base64,'));
    const svg = Buffer.from(metadata.image.split(',')[1], 'base64').toString();
    assert.equal(svg, renderSVG(values));
    assert.ok(Buffer.byteLength(svg) <= 128 * 1024, `Base SVG exceeds 128 KiB project ceiling for #${id}`);
    assert.ok(Buffer.byteLength(uri) <= 256 * 1024, `tokenURI exceeds 256 KiB project ceiling for #${id}`);
    assert.doesNotMatch(svg, /<image|<script|<foreignObject|M0 0h400v400H0z/i);
    const gas = (await token.tokenURI.estimateGas(id)).toString();
    report.tokenURIs.push({tokenId: id.toString(), traits: values, uriBytes: Buffer.byteLength(uri), svgBytes: Buffer.byteLength(svg), gas});
    if (values === largestSVG) {
      report.baseTokenURIDiagnostics.push({gasLimit: 50_000_000, success: true, uriBytes: Buffer.byteLength(uri), elapsedMs: Number(callMs.toFixed(1))});
      for (const gasLimit of [30_000_000, 100_000_000, 150_000_000]) {
        const started = performance.now();
        let diagnosticURI;
        try { diagnosticURI = await token.tokenURI(id, {gasLimit}); }
        catch (error) {
          if (gasLimit !== 30_000_000) throw error;
          report.baseTokenURIDiagnostics.push({gasLimit, success:false, review:'Above optimization target; 50M operating call already passed.'});
          continue;
        }
        assert.equal(diagnosticURI, uri, `Base tokenURI changed at diagnostic gasLimit ${gasLimit}`);
        report.baseTokenURIDiagnostics.push({
          gasLimit,
          success: true,
          uriBytes: Buffer.byteLength(diagnosticURI),
          elapsedMs: Number((performance.now() - started).toFixed(1))
        });
      }
    }
    console.log(`Verified ERC-721 tokenURI #${id}: ${values.join(', ')}`);
  }
  report.tokenURIGas = report.tokenURIs.find(item => JSON.stringify(item.traits)===JSON.stringify(editions[0].genotype)).gas;
  const largestSample = report.tokenURIs.find(item => JSON.stringify(item.traits)===JSON.stringify(largestSVG));
  assert.ok(BigInt(largestSample.gas) <= 50_000_000n, `Base candidate exceeds 50M operating budget; release review required: ${largestSample.gas}`);
  report.gasPolicy = {target:30_000_000,operating:50_000_000,ceiling:100_000_000,
    targetExceeded:report.tokenURIs.some(sample=>BigInt(sample.gas)>30_000_000n)};
  assert.equal(await token.totalSupply(), expectedSupply);
  const balanceSum = await token.balanceOf(alice) + await token.balanceOf(bob) + await token.balanceOf(receiverAddress);
  assert.equal(balanceSum, expectedSupply);
  mark('Seven ERC-721 tokenURIs decode to byte-identical SVG and correct JSON traits; largest-SVG base candidate passes operating/high-budget calls with a separate 30M diagnostic and project byte ceilings.');
  report.finalTestSupply = expectedSupply.toString();
  return report;
}
