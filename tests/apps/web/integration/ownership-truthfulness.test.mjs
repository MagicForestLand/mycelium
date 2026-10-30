import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const source = readFileSync(new URL('../../../../apps/web/src/mycelium.js', import.meta.url), 'utf8')

test('connected ownership without a canonical snapshot renders unknown, never confirmed empty', () => {
  const start = source.indexOf('function renderMyFriends(){')
  const end = source.indexOf("$('friendsWalletAction').onclick", start)
  assert.ok(start >= 0 && end > start)
  const render = source.slice(start, end)
  const unknown = render.indexOf('if(!chainState.snapshot)')
  const empty = render.indexOf('A quiet wallet.')
  assert.ok(unknown >= 0 && empty > unknown, 'Unknown ownership must be handled before the empty-wallet branch')
  assert.match(render, /Collection data is temporarily unavailable/)
  assert.match(render, /nothing has left it/)
})
