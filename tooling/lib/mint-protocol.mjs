import assert from 'node:assert/strict';
import {id,ZeroHash} from 'ethers';
export const mintProtection=Object.freeze({protocol:'commit-reveal-v1',saleLifecycle:'phased-v1',domain:id('MyceliumFriends.PublicMint.v1'),minimumAgeSeconds:60,maximumAgeSeconds:86400,
  publicRoute:'revealMint(uint256[6][],bytes32,uint256,uint256)',directRoutes:'ALLOWLIST_ONLY',payment:'FULLY_FUNDED_MAXIMUM_ATOMIC_REFUND'});
export async function verifyMintProtocolConstants(nft){
  assert.equal(await nft.COMMITMENT_DOMAIN(),mintProtection.domain,'Wrong commitment domain');
  assert.equal(await nft.MIN_COMMITMENT_AGE(),60n,'Wrong minimum commitment age');
  assert.equal(await nft.MAX_COMMITMENT_AGE(),86400n,'Wrong maximum commitment age');
  assert.equal(await nft.MAX_BATCH(),32n,'Wrong protected batch limit');
  assert.equal(await nft.PRICE_STEP(),100_000_000_000_000n,'Wrong public price step');
  return mintProtection;
}
export async function verifyMintProtocol(nft){
  await verifyMintProtocolConstants(nft);
  assert.equal(await nft.commitments(await nft.owner(),ZeroHash),0n,'Invalid initial commitment state');
  return mintProtection;
}
