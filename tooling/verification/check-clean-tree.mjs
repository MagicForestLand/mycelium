import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {projectRoot} from '../lib/compile-contracts.mjs';

const status=execFileSync('git',['status','--porcelain=v1','--untracked-files=all'],{cwd:projectRoot,encoding:'utf8'}).trim();
assert.equal(status,'',`Build/test commands changed the checkout:\n${status}`);
console.log('PASS checkout remains clean, including untracked files');
