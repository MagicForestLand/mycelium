import assert from 'node:assert/strict';

export const STORAGE_LAYOUT_HASH_POLICY='SEMANTIC_STORAGE_LAYOUT_V1_EXCLUDES_SOLC_AST_IDS';

const TYPE_KEYS=new Set(['encoding','label','numberOfBytes','base','key','value','members']);
const ENTRY_KEYS=new Set(['astId','contract','label','offset','slot','type']);

export function semanticStorageLayout(layout){
  assert.ok(layout&&typeof layout==='object'&&!Array.isArray(layout),'Solidity storage layout object required');
  assert.ok(Array.isArray(layout.storage),'Solidity storage layout entries required');
  const types=layout.types??{};
  assert.ok(types&&typeof types==='object'&&!Array.isArray(types),'Solidity storage layout types required');

  const entry=(item,stack=[])=>{
    assert.ok(item&&typeof item==='object'&&!Array.isArray(item),'Invalid Solidity storage entry');
    assert.deepEqual(Object.keys(item).sort(),[...ENTRY_KEYS].filter(key=>Object.hasOwn(item,key)).sort(),'Unexpected Solidity storage entry field');
    for(const key of ['contract','label','offset','slot','type'])assert.ok(Object.hasOwn(item,key),`Missing Solidity storage entry field: ${key}`);
    return {contract:item.contract,label:item.label,offset:item.offset,slot:item.slot,type:type(item.type,stack)};
  };
  const type=(id,stack=[])=>{
    assert.ok(typeof id==='string'&&Object.hasOwn(types,id),`Missing Solidity storage type: ${id}`);
    const value=types[id];
    assert.ok(value&&typeof value==='object'&&!Array.isArray(value),`Invalid Solidity storage type: ${id}`);
    assert.deepEqual(Object.keys(value).sort(),[...TYPE_KEYS].filter(key=>Object.hasOwn(value,key)).sort(),`Unexpected Solidity storage type field: ${id}`);
    for(const key of ['encoding','label','numberOfBytes'])assert.ok(Object.hasOwn(value,key),`Missing Solidity storage type field: ${id}.${key}`);
    if(stack.includes(id))return {recursive:value.label};
    const next=[...stack,id],result={encoding:value.encoding,label:value.label,numberOfBytes:value.numberOfBytes};
    for(const key of ['base','key','value'])if(Object.hasOwn(value,key))result[key]=type(value[key],next);
    if(Object.hasOwn(value,'members')){
      assert.ok(Array.isArray(value.members),`Invalid Solidity storage members: ${id}`);
      result.members=value.members.map(member=>entry(member,next));
    }
    return result;
  };

  return {storage:layout.storage.map(item=>entry(item))};
}
