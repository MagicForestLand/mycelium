export function openSeaTokenURL(deployment,tokenId){
  if(Number(deployment?.chainId)!==1||!/^0x[0-9a-f]{40}$/i.test(deployment?.address||'')||!/^\d+$/.test(String(tokenId)))return '';
  return `https://opensea.io/item/ethereum/${deployment.address}/${encodeURIComponent(String(tokenId))}`;
}

const myceliumFriendsMainnetAddress='0x49f3a83a8ee0b1bb4334c5fa997565926234648f';

export function openSeaCollectionURL(deployment){
  if(Number(deployment?.chainId)!==1||String(deployment?.address||'').toLowerCase()!==myceliumFriendsMainnetAddress)return '';
  return 'https://opensea.io/collection/mycelium-friends?sortBy=created_date&sortDirection=desc';
}

export function sourcifyContractURL(deployment){
  if(Number(deployment?.chainId)!==1||!/^0x[0-9a-f]{40}$/i.test(deployment?.address||''))return '';
  return `https://sourcify.dev/server/v2/contract/1/${deployment.address}`;
}
