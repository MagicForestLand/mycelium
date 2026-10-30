import ganache from 'ganache'
import {BrowserProvider, ContractFactory} from 'ethers'
import {compileContracts} from '../lib/compile-contracts.mjs'
import {checkProtection} from '../lib/check-protection.mjs'
import {checkAllowlist} from './check-allowlist.mjs'
import {TRAIT_COUNTS, MAX_SUPPLY} from '../../collection/source/token-id.js'

console.log('RUN red-team production contract invariants on isolated local EVM')
const {compiled} = compileContracts()
const local = ganache.provider({logging: {quiet: true}, chain: {hardfork: 'shanghai', chainId: 31337}})
const provider = new BrowserProvider(local, undefined, {cacheTimeout: -1})
provider.pollingInterval = 10
try {
  const signer = await provider.getSigner()
  const deploy = async (file, name, args) => {
    const artifact = compiled.contracts[file][name]
    const contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy(...args)
    await contract.waitForDeployment()
    return contract
  }
  const genotypeDescriptor = await deploy('tests/contracts/core/fixtures/MintFixtures.sol', 'GenotypeCountsMock', [TRAIT_COUNTS, MAX_SUPPLY])
  const phenotype = await deploy('contracts/core/PhenotypeRenderer.sol', 'PhenotypeRenderer', [genotypeDescriptor.target])
  const protection = await checkProtection({compiled, provider, signer, genotypeDescriptor, phenotype, local})
  const allowlist = await checkAllowlist({compiled, provider, signer, genotypeDescriptor, phenotype, local})
  console.log(JSON.stringify({status: 'PASS', protectionSeed: protection.seed, statefulTransitions: protection.statefulTransitions, protectionChecks: protection.checks.length, allowlistChecks: allowlist.checks.length}))
} finally {
  provider.destroy()
  await local.disconnect()
}
