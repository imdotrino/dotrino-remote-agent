// LA AUTOACTUALIZACIÓN DE UN AGENTE (`src/update.js`, CONVENCIONES §15): qué se le pasa al
// instalador, qué se le dice a la bóveda, y que NO se reinicia mientras atiende a alguien.
import test from 'node:test'
import assert from 'node:assert/strict'
import { vaultUpdateHooks } from '@dotrino/vault/service'
import { startSelfUpdate, vaultHooks } from '../src/update.js'

const link = { device: { publickey: 'PUB', privateJwk: {} }, cert: { seq: 3 }, iss: 'MASTER', proxy: 'wss://p.example' }
const base = { pkg: '@dotrino/x-agent', repo: 'imdotrino/x', tag: (v) => `agent-v${v}`, label: 'x-agent', dir: '/tmp/x', version: '1.0.0' }

test('el vigilante arranca con el paquete, el repo, el tag y la carpeta', () => {
  let got = null
  startSelfUpdate({ ...base, busy: () => 0, close () {}, watch: (o) => { got = o; return () => {} }, hooks: { mayUpdate () {}, onUpdated () {}, onNeedsRoot () {} } })
  assert.equal(got.pkg, '@dotrino/x-agent')
  assert.equal(got.repo, 'imdotrino/x')
  assert.equal(got.current, '1.0.0')
  assert.equal(got.dir, '/tmp/x')
  assert.equal(got.tag('0.3.0'), 'agent-v0.3.0')
  for (const k of ['mayUpdate', 'onUpdated', 'onNeedsRoot', 'onInstalled']) assert.equal(typeof got[k], 'function', k)
})

test('instalada sin quien lo levante: no se va', () => {
  let got = null; const exits = []; let closed = 0
  startSelfUpdate({ ...base, busy: () => 0, close: () => { closed++ }, exit: (c) => exits.push(c), log () {}, watch: (o) => { got = o; return () => {} }, hooks: {} })
  got.onInstalled({ version: '1.1.0', restart: false })
  assert.deepEqual(exits, [])
  assert.equal(closed, 0)
})

test('instalada con supervisor y libre: cierra y sale', async () => {
  let got = null; const exits = []; let closed = 0
  startSelfUpdate({ ...base, busy: () => 0, close: () => { closed++ }, exit: (c) => exits.push(c), log () {}, watch: (o) => { got = o; return () => {} }, hooks: {} })
  got.onInstalled({ version: '1.1.0', restart: true })
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(exits, [0])
  assert.equal(closed, 1)
})

test('instalada mientras atiende: espera a quedar libre', async () => {
  let got = null; const exits = []; const lines = []; let n = 2
  const stop = startSelfUpdate({ ...base, busy: () => n, close () {}, exit: (c) => exits.push(c), log: (l) => lines.push(l), watch: (o) => { got = o; return () => {} }, hooks: {}, idleCheckMs: 10 })
  got.onInstalled({ version: '1.1.0', restart: true })
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(exits, [])
  assert.match(lines.join('\n'), /busy \(2\)/)
  n = 0
  await new Promise((r) => setTimeout(r, 40))
  assert.deepEqual(exits, [0])
  stop()
})

test('sin enlace, preguntar a la bóveda lanza not-linked (no es un «no»)', async () => {
  const h = vaultHooks({ dir: '/x', product: 'p', log () {}, load: () => null })
  await assert.rejects(() => h.mayUpdate({ version: '1.1.0' }), { code: 'not-linked' })
  await h.onUpdated({ version: '1.1.0' })
})

test('a la bóveda se le habla con el enlace leído en cada llamada', async () => {
  const calls = []
  let current = link
  const make = (o) => vaultUpdateHooks({ ...o, _ask: async (a) => { calls.push(a.cert.seq); return { ok: true, asked: true } }, _done: async () => {}, _root: async () => {} })
  const h = vaultHooks({ dir: '/x', product: 'p', log () {}, load: () => current, make })
  await h.mayUpdate({ version: '1.1.0' })
  current = { ...link, cert: { seq: 4 } }
  await h.mayUpdate({ version: '1.2.0' })
  assert.deepEqual(calls, [3, 4])
})
