import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {projectRoot} from '../lib/compile-contracts.mjs';
import {assertRepositoryReferences} from '../lib/repository-references.mjs';
import {selectPublicRepositoryFiles} from '../release/export-public-repository.mjs';

const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:projectRoot,encoding:'utf8'}).split('\0').filter(file=>file&&existsSync(path.join(projectRoot,file)));
const selected=selectPublicRepositoryFiles(files,JSON.parse(readFileSync(path.join(projectRoot,'tooling/config/public-repository.json'),'utf8')));
assertRepositoryReferences(selected,projectRoot);
assertRepositoryReferences(files,projectRoot,{publicOnly:false});
console.log(`PASS static repository references: ${selected.length} public files; ${files.length} total files.`);
