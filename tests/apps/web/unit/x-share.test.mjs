import test from 'node:test';
import assert from 'node:assert/strict';
import {xComposerURL,xPostText} from '../../../../apps/web/src/x-share.js';

test('X composer links carry prepared text but no website URL',()=>{
  const text=xPostText(42),url=new URL(xComposerURL(text));
  assert.equal(url.origin,'https://x.com');
  assert.equal(url.pathname,'/intent/tweet');
  assert.equal(url.searchParams.get('text'),text);
  assert.equal(url.searchParams.has('url'),false);
  assert.match(text,/myFriend #42/);
  assert.match(text,/#MyceliumFriends/);
});
