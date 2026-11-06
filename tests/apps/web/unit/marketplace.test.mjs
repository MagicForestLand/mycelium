import test from 'node:test';
import assert from 'node:assert/strict';
import {openSeaCollectionURL,openSeaTokenURL,sourcifyContractURL} from '../../../../apps/web/src/marketplace.js';

const address='0x1234567890123456789012345678901234567890';
const myceliumAddress='0x49f3A83a8EE0B1BB4334c5Fa997565926234648F';

test('OpenSea links use its supported Ethereum item route',()=>{
  assert.equal(openSeaTokenURL({chainId:1,address},42),`https://opensea.io/item/ethereum/${address}/42`);
});

test('OpenSea links are omitted for unsupported testnets and invalid tokens',()=>{
  assert.equal(openSeaTokenURL({chainId:11155111,address},42),'');
  assert.equal(openSeaTokenURL({chainId:1,address},'not-a-token'),'');
  assert.equal(openSeaTokenURL({chainId:1,address:'0x123'},42),'');
});

test('OpenSea collection links open mycelium Friends with newest creations first',()=>{
  assert.equal(openSeaCollectionURL({chainId:1,address:myceliumAddress}),'https://opensea.io/collection/mycelium-friends?sortBy=created_date&sortDirection=desc');
  assert.equal(openSeaCollectionURL({chainId:11155111,address:myceliumAddress}),'');
  assert.equal(openSeaCollectionURL({chainId:1,address}),'');
});

test('Sourcify links expose the exact mainnet contract verification record',()=>{
  assert.equal(sourcifyContractURL({chainId:1,address}),`https://sourcify.dev/server/v2/contract/1/${address}`);
  assert.equal(sourcifyContractURL({chainId:31337,address}),'');
  assert.equal(sourcifyContractURL({chainId:1,address:'0x123'}),'');
});
