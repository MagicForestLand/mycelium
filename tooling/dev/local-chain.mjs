import ganache from 'ganache';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const db=process.env.LOCAL_CHAIN_DB?resolve(process.env.LOCAL_CHAIN_DB):fileURLToPath(new URL('../../.dev/chain',import.meta.url));
await mkdir(db,{recursive:true});
const server=ganache.server({database:{dbPath:db},logging:{quiet:true},
  chain:{chainId:31337,networkId:31337,hardfork:'shanghai',allowUnlimitedContractSize:false},
  wallet:{deterministic:true,totalAccounts:10,defaultBalance:1000},miner:{blockGasLimit:60_000_000},
  server:{ws:false}});
await server.listen(8545,'127.0.0.1');
console.log(`myFriends local chain → http://127.0.0.1:8545 (31337)\nState: ${db}. Test ETH only.`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
