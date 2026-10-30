import assert from 'node:assert/strict';
import {Contract} from 'ethers';
import {OPEN,GROUP} from '../../collection/source/art.js';

// HeaderStore and its raw SVG pages are deployed internally by the descriptor,
// so they are not explicit steps in the deployment plan. Verify them too.
export async function verifyHeaderStore({provider,address,artifact}){
  assert.ok(artifact,'Missing compiled SVGHeaderStore artifact');
  const actual=Buffer.from((await provider.getCode(address)).slice(2),'hex');
  const expected=Buffer.from(artifact.deployedBytecode.slice(2),'hex');
  assert.equal(actual.length,expected.length,'SVGHeaderStore: runtime length mismatch');
  for(const slots of Object.values(artifact.immutableReferences))for(const {start,length} of slots){actual.fill(0,start,start+length);expected.fill(0,start,start+length);}
  assert.deepEqual(actual,expected,'SVGHeaderStore: runtime code mismatch');
  const store=new Contract(address,artifact.abi,provider),header=Buffer.from(OPEN+GROUP);
  let offset=0,pageCount=0;
  while(offset<header.length){
    const [source,length,start]=await store.page(pageCount);
    assert.equal(start,BigInt(offset),'SVG header page offset mismatch');
    assert.ok(length>0n&&length<=24576n&&length<=BigInt(header.length-offset),'Invalid SVG header page length');
    const code=Buffer.from((await provider.getCode(source)).slice(2),'hex');
    assert.deepEqual(code,header.subarray(offset,offset+Number(length)),'SVG header page bytes mismatch');
    offset+=Number(length);pageCount++;
  }
  await assert.rejects(()=>store.page(pageCount),error=>error.code==='CALL_EXCEPTION');
  return pageCount;
}
