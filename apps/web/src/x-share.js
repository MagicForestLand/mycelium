export function xPostText(tokenId){
  return `Meet myFriend #${tokenId} 🍄\n\nA little friend. Entirely mine.\n\n#MyceliumFriends`;
}

export function xComposerURL(text){
  return 'https://x.com/intent/tweet?'+new URLSearchParams({text}).toString();
}
