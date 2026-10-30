export function openSeaTokenURL(deployment,tokenId){
  if(Number(deployment?.chainId)!==1||!/^0x[0-9a-f]{40}$/i.test(deployment?.address||'')||!/^\d+$/.test(String(tokenId)))return '';
  return `https://opensea.io/item/ethereum/${deployment.address}/${encodeURIComponent(String(tokenId))}`;
}

export function sourcifyContractURL(deployment){
  if(Number(deployment?.chainId)!==1||!/^0x[0-9a-f]{40}$/i.test(deployment?.address||''))return '';
  return `https://sourcify.dev/server/v2/contract/1/${deployment.address}`;
}
