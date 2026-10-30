import assert from 'node:assert/strict';
import {getAddress,isAddress,ZeroAddress,keccak256,toQuantity} from 'ethers';

export const deploymentRoles=['initialOwner','treasury','royaltyReceiver'];

export function validateRoleAddresses(config, addresses={}) {
  const occupied=new Map();
  for(const [name,address] of Object.entries(addresses)){
    assert.ok(isAddress(address)&&getAddress(address)!==ZeroAddress,`Invalid deployment address: ${name}`);
    const key=address.toLowerCase();
    assert.ok(!occupied.has(key),`Deployment address collision: ${name} / ${occupied.get(key)}`);
    occupied.set(key,name);
  }
  for(const role of deploymentRoles){
    assert.ok(typeof config[role]==='string'&&isAddress(config[role])&&getAddress(config[role])!==ZeroAddress,`Set a nonzero ${role}`);
    assert.ok(!occupied.has(config[role].toLowerCase()),`${role} collides with deployment contract ${occupied.get(config[role].toLowerCase())}`);
  }
  // Shared role wallets are legal; report them instead of silently forbidding a Safe.
  return deploymentRoles.flatMap((role,i)=>deploymentRoles.slice(i+1)
    .filter(other=>config[role].toLowerCase()===config[other].toLowerCase()).map(other=>[role,other]));
}

export async function checkTreasuryReceiving({provider,config,addresses,blockTag,amountWei}) {
  const sharedRoles=validateRoleAddresses(config,addresses);
  assert.ok(addresses.MyceliumFriends,'Missing NFT address for treasury simulation');
  assert.ok(typeof blockTag==='string'&&/^0x[0-9a-f]+$/i.test(blockTag),'Pin a numeric block tag');
  assert.ok(typeof amountWei==='bigint'&&amountWei>0n,'Set a positive treasury probe amount');
  const roles={};
  for(const role of deploymentRoles){
    const code=await provider.send('eth_getCode',[config[role],blockTag]);
    roles[role]={address:getAddress(config[role]),hasCode:code!=='0x',codeHash:keccak256(code)};
  }
  // Read-only balance override: this sends no ETH and does not require a funded NFT.
  // Fail closed when the RPC cannot simulate overrides. Contract treasuries, including
  // Safes, remain valid. This probes receiving at one block, not control or future upgrades.
  await provider.send('eth_call',[
    {from:addresses.MyceliumFriends,to:config.treasury,value:toQuantity(amountWei),data:'0x',gas:toQuantity(1_000_000)},
    blockTag,{[addresses.MyceliumFriends]:{balance:toQuantity(amountWei)}}
  ]);
  return {roles,sharedRoles,treasuryProbe:{passed:true,blockTag,amountWei:amountWei.toString(),sender:addresses.MyceliumFriends,
    scope:'Empty-calldata receiving simulation only; wallet control, future policy and actual withdrawal must be checked separately'}};
}
