import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync, existsSync, readdirSync, statSync} from 'node:fs'
import path from 'node:path'

const root = path.resolve(new URL('../..', import.meta.url).pathname)
const secretRules = [
  ['raw private-key field', /(?:"|')?(?:privateKey|secretKey)(?:"|')?\s*[:=]\s*(?:"|')(?:0x)?[0-9a-f]{64}(?:"|')/i],
  ['mnemonic field', /(?:"|')?(?:mnemonic|seedPhrase|recoveryPhrase)(?:"|')?\s*[:=]\s*(?:"|')[^\n"']{20,}(?:"|')/i],
  ['wallet keystore', /"(?:crypto|Crypto)"\s*:\s*\{[\s\S]{0,3000}"ciphertext"\s*:/i]
]

function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z'], {cwd: root})
    .toString('utf8').split('\0').filter(Boolean)
}

function secretFindings(files, base = root) {
  const findings = []
  for (const file of files) {
    const full = path.join(base, file)
    if (!existsSync(full) || statSync(full).isDirectory()) continue
    const bytes = readFileSync(full)
    if (bytes.includes(0)) continue
    const text = bytes.toString('utf8')
    for (const [rule, pattern] of secretRules) if (pattern.test(text)) findings.push({file, rule})
  }
  return findings
}

function findingsInText(text, file) {
  return secretRules.flatMap(([rule, pattern]) => pattern.test(text) ? [{file, rule}] : [])
}

function filesBelow(dir, prefix = '') {
  if (!existsSync(dir)) return []
  return readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const relative = path.join(prefix, entry.name)
    return entry.isDirectory() ? filesBelow(path.join(dir, entry.name), relative) : [relative]
  })
}

test('tracked sources contain no private-key, mnemonic, keystore, or ignored wallet export', () => {
  const files = trackedFiles()
  assert.equal(files.some(file => file === '.env' || file.startsWith('.env.') && file !== '.env.example'), false)
  assert.equal(files.some(file => file === '.dev' || file.startsWith('.dev/')), false)
  assert.equal(files.includes('ui_context.txt'), false)
  assert.deepEqual(secretFindings(files), [])
})

test('private-key fields detect optional prefixes without treating ordinary hashes as keys', () => {
  const hexA = 'a'.repeat(64), hexB = 'b'.repeat(64), hexC = 'c'.repeat(64), hash = 'd'.repeat(64)
  assert.deepEqual(findingsInText(`{"privateKey":"0x${hexA}"}`, 'prefixed.json'), [{file: 'prefixed.json', rule: 'raw private-key field'}])
  assert.deepEqual(findingsInText(`privateKey = '${hexB}'`, 'unprefixed.js'), [{file: 'unprefixed.js', rule: 'raw private-key field'}])
  assert.deepEqual(findingsInText(`secretKey: "${hexC}"`, 'secret-key.js'), [{file: 'secret-key.js', rule: 'raw private-key field'}])
  assert.deepEqual(findingsInText(`{"transactionHash":"0x${hash}","runtimeHash":"${hash}"}`, 'ordinary-hashes.json'), [])
})

test('current static-site artifact contains no recognized wallet-secret context', () => {
  const site = path.join(root, 'output/site')
  const files = filesBelow(site)
  assert.deepEqual(secretFindings(files, site), [])
})

test('export tooling uses an explicit public allowlist and never copies repository root or dev secrets', () => {
  const source = readFileSync(path.join(root, 'tooling/build/export-site.mjs'), 'utf8')
  assert.match(source, /const PUBLIC_ASSETS=Object\.freeze\(\[/)
  assert.doesNotMatch(source, /['"]assets['"]|cp\([^\n]*recursive\s*:\s*true/)
  assert.doesNotMatch(source, /cp\((?:'|"|`)\.(?:'|"|`)/)
  assert.doesNotMatch(source, /\.env|ui_context|privateKey|mnemonic/)
})
