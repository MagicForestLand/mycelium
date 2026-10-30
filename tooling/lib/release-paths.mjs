import assert from 'node:assert/strict';
import {existsSync,realpathSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from './compile-contracts.mjs';

export function assertExternalOutput(target){
  assert.ok(typeof target==='string'&&target.length,'Explicit external production output path required');
  let existing=path.resolve(target),suffix=[];
  while(!existsSync(existing)){suffix.unshift(path.basename(existing));existing=path.dirname(existing);}
  const resolved=path.join(realpathSync(existing),...suffix),root=realpathSync(projectRoot);
  assert.ok(resolved!==root&&!resolved.startsWith(root+path.sep),'Production artifacts/reports must be outside the clean source repository');
}
