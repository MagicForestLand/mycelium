const SHARE_BASE_URL='https://api.mycelium.magicforest.land/share/myfriend/';

export function myFriendShareURL(tokenId){
  return SHARE_BASE_URL+encodeURIComponent(String(tokenId));
}

export function xPostText(tokenId){
  return `Meet myFriend #${tokenId} 🍄\n${myFriendShareURL(tokenId)}`;
}

export function xComposerURL(text){
  return 'https://x.com/intent/tweet?'+new URLSearchParams({text}).toString();
}
