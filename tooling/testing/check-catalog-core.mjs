import {withCommitReveal} from '../lib/protected-test-client.mjs';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory} from 'ethers';
import {compileContracts} from '../lib/compile-contracts.mjs';
import {generateBanks} from '../lib/generate-banks.mjs';
const keys=['stem','cap','temperament','glasses','accessory','hobby'];
for(const counts of [[23,100,22,23,13,32],[23,120,25,30,40,50]]){
  const traits=Object.fromEntries(keys.map((key,i)=>[key,Array.from({length:counts[i]},(_,j)=>({id:`${key.toLowerCase()}-${j}`,name:`Trait ${j}`,description:`Description ${j}.`,data:'00000100'}))]));
  const {schema}=generateBanks(traits,keys),max=counts.reduce((a,b)=>a*b,1);
  const {compiled}=compileContracts({sourceOverrides:{'contracts/core/generated/GenomeSchema.sol':schema}});
  const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'}});
  try{
    const provider=new BrowserProvider(local);provider.pollingInterval=10;const signer=await provider.getSigner(),owner=await signer.getAddress();
    const deploy=async(file,name,args=[])=>{const a=compiled.contracts[file][name];const c=await new ContractFactory(a.abi,a.evm.bytecode.object,signer).deploy(...args);await c.waitForDeployment();return c;};
    const genotypeDescriptor=await deploy('tests/contracts/core/fixtures/MintFixtures.sol','GenotypeCountsMock',[counts,max]);
    const phenotype=await deploy('contracts/core/PhenotypeRenderer.sol','PhenotypeRenderer',[await genotypeDescriptor.getAddress()]);
    const rawToken=await deploy('contracts/core/MyceliumFriends.sol','MyceliumFriends',[await genotypeDescriptor.getAddress(),await phenotype.getAddress(),owner,owner,2,owner]);
    const token=withCommitReveal(rawToken,local);
    await(await token.startAllowlistSale()).wait();await(await token.openPublicSale()).wait();
    assert.equal(await token.MAX_SUPPLY(),BigInt(max));
    const high=counts.map(n=>n-1);const packed=high.reduce((value,n,i)=>value|(BigInt(n)<<BigInt(i*8)),0n);
    assert.equal(await token.genotypeForTraits(...high),packed);assert.equal(await token.tokenForTraits(...high),0n);
    await(await token.mint(...high)).wait();
    await(await token.mint(0,0,0,0,0,0,{value:100_000_000_000_000n})).wait();
    assert.equal(await token.ownerOf(1),owner);assert.equal(await token.ownerOf(2),owner);
    assert.equal(await token.tokenForTraits(...high),1n);assert.deepEqual(Array.from(await token.traitsForTokenId(1),Number),high);
    assert.equal(await token.totalMinted(),2n);assert.equal(await token.ownershipEpoch(1),1n);
    console.log(`PASS: sequential NFT IDs with counts ${counts.join(' x ')}, genotype space ${max}, independent sale cap 2.`);
  }finally{await local.disconnect();}
}
