import assert from 'node:assert/strict';
import {ContractFactory} from 'ethers';

export async function checkRenderer({compiled, signer}) {
  const artifact = compiled.contracts['tests/contracts/core/fixtures/RendererFixtures.sol'].RendererFixtures;
  const harness = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy();
  await harness.waitForDeployment();
  const checks = [];
  const bubbleArtifact=compiled.contracts['tests/contracts/core/fixtures/RendererFixtures.sol'].BubbleTextHarness;
  const bubble=await new ContractFactory(bubbleArtifact.abi,bubbleArtifact.evm.bytecode.object,signer).deploy();
  await bubble.waitForDeployment();
  for(const text of ['', '\u041f\u0440\u0438\u0432\u0435\u0442, \u0433\u0440\u0438\u0431!\n🍄 hello', '<script>&"\'', 'a'.repeat(24)+'\n'+'b'.repeat(24)+'\n'+'c'.repeat(24)])assert.equal(await bubble.valid(Buffer.from(text)),true);
  for(const raw of ['00','09','0d','7f','80','c0af','c28080','e08080','eda080','efbfbf','f0808080','f4908080','f09f8d',Buffer.from('a'.repeat(25)).toString('hex'),Buffer.from('a\nb\nc\nd').toString('hex'),'61'.repeat(193)])assert.equal(await bubble.valid('0x'+raw),false,raw);
  checks.push('Bubble UTF-8 validation: Cyrillic/emoji, 3x24 scalar limits, invalid/truncated/overlong sequences, surrogates, controls and XML noncharacters.');
  const verify = async bytes => {
    const expected = bytes.toString('base64');
    const [optimized, reference] = await harness.encodings(bytes, {gasLimit: 29_000_000});
    assert.equal(optimized, expected);
    assert.equal(reference, expected);
  };
  for (const value of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar']) await verify(Buffer.from(value));
  for (const length of [...Array.from({length: 100}, (_, i) => i), 127, 128, 129, 255, 256, 257, 1023, 1024, 1025, 4095, 4096, 4097, 50000]) {
    const bytes = Buffer.from(Array.from({length}, (_, i) => (i * 73 + length * 11) % 256));
    await verify(bytes);
    if (length <= 129) assert.equal(await harness.dirtyPadding(bytes), bytes.toString('base64'));
  }
  // Every 12-bit lookup value appears in every one of the four pair positions.
  const exhaustive = [];
  for (let v = 0; v < 4096; v++) {
    const triple = [v >> 4, ((v & 15) << 4) | (v >> 8), v & 255];
    exhaustive.push(...triple, ...triple);
  }
  await verify(Buffer.from(exhaustive));
  checks.push('Pair Base64 matches Node and OpenZeppelin: RFC vectors, all 4096 pairs in every position, lengths 0..99, word boundaries, dirty padding and 50 KB input.');

  const rows = [];
  for (let x = 0; x < 80; x++) {
    for (const count of new Set([1, 80 - x])) {
      for (const y of [0, 1, 19, 20, 79]) rows.push([x, y, count, (x * 17 + y) % 256]);
    }
  }
  for (let color = 0; color < 256; color++) rows.push([0, 79, 80, color]);
  for (let start = 0; start < rows.length; start += 64) {
    const batch = rows.slice(start, start + 64);
    const expected = batch.map(([x, y, count, color]) => `<path fill="url(#bs-p${color})" d="M${x * 5} ${y * 5}h${count * 5}v5h-${count * 5}z"/>`).join('');
    assert.equal(await harness.beadPaths(Buffer.from(batch.flat())), expected + '|memory-guard|');
  }
  assert.equal(await harness.beadPaths('0x'), '|memory-guard|');
  for (const bad of ['00', '0000', '000000', '00000000', '50000100', '00500100', '4f000200', '0000ff00']) {
    await assert.rejects(() => harness.beadPaths('0x' + bad), error => {
      assert.equal(error.data, '0xca2c8d2e');
      return true;
    });
  }
  checks.push('Direct SVG writer matches 1051 boundary/color runs; malformed data reverts and adjacent allocations stay intact.');
  for (const check of checks) console.log(`PASS: ${check}`);
  return checks;
}
