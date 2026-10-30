import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {getAddress} from 'ethers';
import {verifyProductionInputs} from '../lib/release-binding.mjs';
import {validateMainnetDeploymentIntent,verifyMainnetSignedTransaction} from '../lib/mainnet-transactions.mjs';
import {writePrivateJSON} from './mainnet-release.mjs';

export const FOUNDRY_LEDGER_PIN=Object.freeze({
  version:'1.7.1',
  commit:'4072e48705af9d93e3c0f6e29e93b5e9a40caed8'
});

const execFileAsync=promisify(execFile);

export function assertPinnedCastVersion(output){
  assert.match(output,new RegExp(`^cast Version: ${FOUNDRY_LEDGER_PIN.version.replaceAll('.','\\.')}\\s*$`,'m'),'Unexpected cast version');
  assert.match(output,new RegExp(`^Commit SHA: ${FOUNDRY_LEDGER_PIN.commit}\\s*$`,'m'),'Unexpected cast commit');
}

export function ledgerAddressArgs(derivationPath){
  assert.ok(typeof derivationPath==='string'&&/^m\/(?:[0-9]+'?\/)*[0-9]+'?$/.test(derivationPath),'Explicit Ledger derivation path required');
  return ['wallet','address','--ledger','--mnemonic-derivation-path',derivationPath];
}

export function ledgerSigningArgs(intent,derivationPath){
  ledgerAddressArgs(derivationPath);
  assert.equal(intent?.chainId,1,'Ledger signer is restricted to Ethereum mainnet');
  assert.equal(intent?.transaction?.type,2,'Ledger signer requires an EIP-1559 intent');
  assert.equal(intent.transaction.to,null,'Ledger signer only accepts CREATE transactions');
  assert.equal(intent.transaction.value,'0','Ledger signer only accepts zero-value deployments');
  return [
    'mktx','--chain','1','--nonce',String(intent.nonce),'--gas-limit',intent.transaction.gasLimit,
    '--gas-price',intent.transaction.maxFeePerGas,'--priority-gas-price',intent.transaction.maxPriorityFeePerGas,
    '--ledger','--mnemonic-derivation-path',derivationPath,'--create',intent.transaction.data
  ];
}

function signerEnvironment(environment=process.env){
  const clean={...environment};
  for(const name of [
    'PRIVATE_KEY','MNEMONIC','RPC_URL','CHAIN','ETH_FROM','ETH_GAS_LIMIT','ETH_GAS_PRICE','ETH_PRIORITY_GAS_PRICE',
    'ETH_PRIVATE_KEY','ETH_RPC_URL','ETH_KEYSTORE','ETH_KEYSTORE_ACCOUNT','ETH_PASSWORD','AWS_KMS_KEY_ID',
    'GCP_PROJECT_ID','GCP_LOCATION','GCP_KEY_RING','GCP_KEY_NAME','GCP_KEY_VERSION','TURNKEY_API_PRIVATE_KEY','TURNKEY_ORGANIZATION_ID'
  ])delete clean[name];
  return clean;
}

async function defaultRunCast(castBinary,args){
  const {stdout}=await execFileAsync(castBinary,args,{encoding:'utf8',env:signerEnvironment(),maxBuffer:2*1024*1024});
  return stdout.trim();
}

export async function signMainnetIntentWithLedger({manifest,expectedDigest,intent,derivationPath,castBinary='cast',runCast=defaultRunCast}){
  validateMainnetDeploymentIntent(intent,manifest,expectedDigest);
  const version=await runCast(castBinary,['--version']);assertPinnedCastVersion(version);
  const ledgerAddress=getAddress((await runCast(castBinary,ledgerAddressArgs(derivationPath))).trim());
  assert.equal(ledgerAddress,getAddress(intent.from),'Ledger address differs from the approved deployer');
  const rawTransaction=(await runCast(castBinary,ledgerSigningArgs(intent,derivationPath))).trim();
  const signed=verifyMainnetSignedTransaction(rawTransaction,intent,manifest,expectedDigest);
  return {
    format:1,
    kind:'MYCELIUM_LEDGER_SIGNED_TRANSACTION',
    status:'SIGNED_NOT_BROADCAST',
    foundry:FOUNDRY_LEDGER_PIN,
    derivationPath,
    ledgerAddress,
    releaseDigest:signed.releaseDigest,
    intentDigest:signed.intentDigest,
    stepIndex:signed.stepIndex,
    step:signed.step,
    expectedContract:signed.expectedContract,
    nonce:signed.nonce,
    transactionHash:signed.transactionHash,
    rawTransaction:signed.rawTransaction
  };
}

function parse(argv){
  const [manifestPath,intentPath,...rest]=argv,take=flag=>{const index=rest.indexOf(flag);return index<0?undefined:rest[index+1];};
  return {manifestPath,intentPath,expectedDigest:take('--expected-release'),derivationPath:take('--derivation-path'),
    castBinary:take('--cast')||'cast',outputPath:take('--output')};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=parse(process.argv.slice(2));
  assert.ok(args.manifestPath&&args.intentPath&&args.expectedDigest&&args.derivationPath&&args.outputPath,
    'Usage: node tooling/release/ledger-sign-intent.mjs manifest.json intent.json --expected-release SHA256 --derivation-path PATH --cast /pinned/cast --output /external/signed.json');
  const manifest=JSON.parse(await readFile(args.manifestPath,'utf8'));
  const intent=JSON.parse(await readFile(args.intentPath,'utf8'));
  await verifyProductionInputs(manifest,args.expectedDigest);
  const signed=await signMainnetIntentWithLedger({...args,manifest,intent});
  await writePrivateJSON(args.outputPath,signed);
  console.log(`Signed ${signed.step} nonce ${signed.nonce} as ${signed.ledgerAddress}. NOT BROADCAST.`);
}
