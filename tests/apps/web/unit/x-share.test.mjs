import test from 'node:test';
import assert from 'node:assert/strict';
import {myFriendShareURL,xComposerURL,xPostText} from '../../../../apps/web/src/x-share.js';

test('X composer links carry the token share page in the prepared text',()=>{
  const text=xPostText(42),url=new URL(xComposerURL(text));
  assert.equal(url.origin,'https://x.com');
  assert.equal(url.pathname,'/intent/tweet');
  assert.equal(url.searchParams.get('text'),text);
  assert.equal(url.searchParams.has('url'),false);
  assert.equal(myFriendShareURL(42),'https://api.mycelium.magicforest.land/share/myfriend/42');
  assert.equal(text,'Meet myFriend #42 🍄\nhttps://api.mycelium.magicforest.land/share/myfriend/42');
});
