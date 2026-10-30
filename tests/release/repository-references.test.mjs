import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceFindings} from '../../tooling/lib/repository-references.mjs';
import {siteSourcePath} from '../../tooling/lib/site-paths.mjs';

test('public imports and links cannot reach private material even if it exists',()=>{
  const sources={'src/app.js':"import '../internal/testnet/tool.js';",'README.md':'[private](internal/README.md)','internal/testnet/tool.js':'','internal/README.md':''};
  assert.equal(referenceFindings(Object.keys(sources),file=>sources[file]).filter(f=>f.reason==='private dependency').length,2);
});
test('stale imports, file URLs, documentation links and npm entrypoints fail closed',()=>{
  const sources={'src/app.js':"import './missing.js'; new URL('../docs/OLD.md',import.meta.url);",'README.md':'[old](docs/OLD.md)', 'package.json':JSON.stringify({scripts:{test:'node tooling/old.mjs'}})};
  assert.equal(referenceFindings(Object.keys(sources),file=>sources[file]).length,4);
});
test('resolved imports and directory links survive without private history',()=>{
  const sources={'src/app.js':"import './lib.js';",'src/lib.js':'','README.md':'[source](src/) [external](https://example.com/)'};
  assert.deepEqual(referenceFindings(Object.keys(sources),file=>sources[file]),[]);
});

test('site URL mapping is independent of repository placement and covers lazy HTML imports',()=>{
  for(const [url,file] of Object.entries({'/':'apps/web/index.html','/index.html':'apps/web/index.html','/chain-config.json':'apps/web/chain-config.json','/assets/site.css':'apps/web/assets/site.css','/mycelium.bundle.js':'apps/web/mycelium.bundle.js','/output/branding/avatar.svg':'output/branding/avatar.svg'}))assert.equal(siteSourcePath(url),file);
  const sources={'apps/web/index.html':'<link href="assets/site.css"><script type="module">import("./assets/web3/app.js");</script>','apps/web/assets/site.css':''};
  assert.deepEqual(referenceFindings(Object.keys(sources),file=>sources[file]),[]);
  sources['apps/web/index.html']='<script type="module">import("./missing.js");</script>';
  assert.equal(referenceFindings(Object.keys(sources),file=>sources[file])[0].kind,'HTML module');
  sources['apps/web/index.html']='<script type="module">import("../internal/private.js");</script>';
  assert.equal(referenceFindings(Object.keys(sources),file=>sources[file])[0].reason,'unresolved reference');
});
