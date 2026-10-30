import assert from 'node:assert/strict';
import ganache from 'ganache';
import {BrowserProvider,ContractFactory} from 'ethers';
import {compileContracts,artifactFor} from '../lib/compile-contracts.mjs';
import {verifyHeaderStore} from '../lib/verify-header.mjs';
const {compiled}=compileContracts({fixtures:false});
const artifact=artifactFor(compiled,'contracts/core/generated/SVGConstants.sol','SVGHeaderStore');
const local=ganache.provider({logging:{quiet:true},chain:{hardfork:'shanghai'}});
try{
  const provider=new BrowserProvider(local);provider.pollingInterval=10;
  const store=await new ContractFactory(artifact.abi,artifact.bytecode,await provider.getSigner()).deploy();
  await store.waitForDeployment();const address=await store.getAddress();
  const pages=await verifyHeaderStore({provider,address,artifact});assert.ok(pages>0);
  const [page]=await store.page(0);
  for(const target of [address,page]){
    const runner={call:provider.call.bind(provider),getCode:addr=>addr.toLowerCase()===target.toLowerCase()?'0x00':provider.getCode(addr)};
    await assert.rejects(()=>verifyHeaderStore({provider:runner,address,artifact}),/SVGHeaderStore: runtime|SVG header page bytes/);
  }
  console.log(`PASS: internally deployed SVGHeaderStore and ${pages} raw pages verified; substituted store/page rejected.`);
}finally{await local.disconnect();}
