/**
 * AUDITORÍA DEL 2026-11-16: «que los servicios no acepten conexiones fuera del acta».
 *
 *   · el permiso de PRODUCTO (`needs`) se exige al saludar y se vuelve a mirar con cada acta;
 *   · un DATA con el `sid` de otro no cambia por dónde se contesta ni mantiene viva la sesión;
 *   · un saludo con la firma mal no despierta a la bóveda;
 *   · un aviso de bloqueo, que cualquiera puede mandar, va con freno.
 *
 * En las pruebas el permiso de producto es `approve` (uno que ya existe en el acta de la
 * versión de identity instalada); en los agentes es `terminal` o `desktop`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeDeviceKey, signDelegationWith, signWithDevice } from '@dotrino/identity/capabilities'
import { genesisActa, applyChanges, sealActa } from '@dotrino/identity/acta'
import { startRemoteAgent } from '../src/agent.js'
import { missingCaps } from '../src/membership.js'
import { makeThrottle } from '../src/catch-up.js'
import { HS, ACK, ERROR, DATA, VMSG } from '../protocol.js'
import { makeEphemeral } from '../e2e.js'

async function vault () {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const iss = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey))
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  let acta = await sealActa({ acta: genesisActa({ pub: iss, label: 'bóveda' }), privateJwk })
  const change = async (ch) => { acta = await sealActa({ acta: await applyChanges(acta, [ch], { by: iss }), privateJwk }) }
  return {
    iss,
    get acta () { return acta },
    admit: (pub, label, caps = ['sign']) => change({ op: 'admit', member: { pub, label, cn: null, caps } }),
    caps: (pub, caps) => change({ op: 'caps', pub, caps }),
    remove: (pub) => change({ op: 'remove', pub }),
    async cert (sub) { return signDelegationWith(pair.privateKey, iss, { sub, scope: ['vault:sign'], iat: Date.now(), seq: acta.seq, nonce: crypto.randomUUID() }) }
  }
}

function bus () {
  const byToken = new Map(); const byPubkey = new Map()
  const deliver = (c, from, obj) => queueMicrotask(() => { for (const fn of c._h) fn(from, obj) })
  const endpoint = (token) => {
    const c = {
      token, url: 'wss://bus.invalid', _h: [],
      on (ev, fn) { if (ev !== 'message') return () => {}; c._h.push(fn); return () => { const i = c._h.indexOf(fn); if (i >= 0) c._h.splice(i, 1) } },
      async identifyAs ({ publickey, sign } = {}) { await sign?.({ op: 'identify', publickey, ts: Date.now() }); byPubkey.set(publickey, c); return { ok: true } },
      send (to, obj) { const t = byToken.get(to); if (t) deliver(t, token, obj) },
      sendByPubkey (pub, obj) { const t = byPubkey.get(pub); if (t) deliver(t, token, obj) },
      close () {}
    }
    byToken.set(token, c); return c
  }
  return { endpoint }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))


/** Un agente con `needs` sobre el bus, con la bóveda contestando (y contando lo que se le pide). */
async function setup (needs, before = async (_v) => {}) {
  const v = await vault(); const b = bus()
  const machine = await makeDeviceKey()
  await v.admit(machine.publickey, 'pc')
  // Lo que ya estaba en el acta al arrancar (si llega después, el agente renueva su papel, y
  // esta bóveda de mentira no contesta a eso).
  await before(v)
  const link = { device: machine, cert: await v.cert(machine.publickey), acta: v.acta, actaSeq: v.acta.seq, actaTrusted: true, iss: v.iss, proxy: 'wss://bus.invalid', label: 'pc', at: Date.now() }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-audit-'))
  fs.writeFileSync(path.join(dir, 'link.json'), JSON.stringify(link))
  const vaultEp = b.endpoint('tok-vault')
  const asked = { n: 0 }
  vaultEp.on('message', (from, p) => { if (p?.type === VMSG.DEVICES) { asked.n++; vaultEp.send(from, { type: VMSG.DEVICES_RESULT, devices: [], revoked: [], blocked: [], acta: v.acta }) } })
  await vaultEp.identifyAs({ publickey: v.iss })
  const sessions = []
  const agent = await startRemoteAgent({ dir, quiet: true, needs, client: b.endpoint('tok-agent'), onSession: (s) => sessions.push(s) })
  await wait(50)
  const greet = async (dev, token) => {
    const ep = b.endpoint(token); const replies = []
    ep.on('message', (_f, p) => replies.push(p))
    const eph = await makeEphemeral()
    const data = { op: HS, eph: eph.pub, publickey: dev.publickey, ts: Date.now() }
    const { signature } = await signWithDevice({ privateJwk: dev.privateJwk, data })
    ep.send('tok-agent', { type: HS, data, signature, cert: await v.cert(dev.publickey) })
    await wait(100)
    return { ep, replies }
  }
  const done = () => { agent.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  return { v, b, machine, vaultEp, asked, sessions, greet, done }
}

test('missingCaps: los que faltan; sin acta, todos', async () => {
  const v = await vault(); const a = await makeDeviceKey()
  await v.admit(a.publickey, 'a', ['sign', 'approve'])
  assert.deepEqual(missingCaps(v.acta, a.publickey, ['approve']), [])
  assert.deepEqual(missingCaps(v.acta, a.publickey, ['approve', 'admin']), ['admin'])
  assert.deepEqual(missingCaps(null, a.publickey, ['approve']), ['approve'])
})

test('agente: un aparato del acta con `sign` pero sin el permiso del producto no abre sesión, y se le dice cuál falta', async () => {
  const laptop = await makeDeviceKey()
  const s = await setup(['approve'], (v) => v.admit(laptop.publickey, 'laptop'))
  const { replies } = await s.greet(laptop, 'tok-laptop')
  const err = replies.find((p) => p.type === ERROR)
  assert.ok(err, 'rechazado')
  assert.equal(err.reason, 'missing-cap')
  assert.deepEqual(err.caps, ['approve'])
  assert.equal(s.sessions.length, 0)
  s.done()
})

test('agente: con el permiso entra; si se lo quitan con la sesión abierta, se le cierra', async () => {
  const s = await setup(['approve'])
  const laptop = await makeDeviceKey(); await s.v.admit(laptop.publickey, 'laptop', ['sign', 'approve'])
  s.vaultEp.sendByPubkey(s.machine.publickey, { type: 'vault.admin.event', body: { ev: 'admitted' }, acta: s.v.acta })
  await wait(80)
  const { replies } = await s.greet(laptop, 'tok-laptop')
  assert.equal(replies.at(-1).type, ACK)
  let closed = false; s.sessions[0].on('close', () => { closed = true })
  await s.v.caps(laptop.publickey, ['sign'])
  s.vaultEp.sendByPubkey(s.machine.publickey, { type: 'vault.admin.event', body: { ev: 'caps' }, acta: s.v.acta })
  await wait(120)
  assert.equal(closed, true)
  assert.ok(replies.find((p) => p.type === ERROR && p.reason === 'missing-cap'))
  s.done()
})

test('agente: un DATA con el `sid` de una sesión, desde otro token y sin su llave, no la desvía ni la mantiene viva', async () => {
  const s = await setup([])
  const laptop = await makeDeviceKey(); await s.v.admit(laptop.publickey, 'laptop')
  s.vaultEp.sendByPubkey(s.machine.publickey, { type: 'vault.admin.event', body: { ev: 'admitted' }, acta: s.v.acta })
  await wait(80)
  const { replies } = await s.greet(laptop, 'tok-laptop')
  assert.equal(replies.at(-1).type, ACK)
  const sess = s.sessions[0]
  const exp = sess._exp
  const evil = s.b.endpoint('tok-evil')
  await wait(5)
  evil.send('tok-agent', { type: DATA, sid: sess.sid, env: { iv: 'AAAA', ct: 'AAAA' } })
  await wait(80)
  assert.equal(sess.from, 'tok-laptop', 'sigue contestando al aparato de verdad')
  assert.equal(sess._exp, exp, 'la basura no renueva la sesión')
  s.done()
})

test('agente: un saludo con la firma mal no despierta a la bóveda', async () => {
  const s = await setup([])
  await wait(50)
  const before = s.asked.n
  const stranger = await makeDeviceKey(); const other = await makeDeviceKey()
  const ep = s.b.endpoint('tok-x'); const replies = []
  ep.on('message', (_f, p) => replies.push(p))
  const eph = await makeEphemeral()
  const data = { op: HS, eph: eph.pub, publickey: stranger.publickey, ts: Date.now() }
  const { signature } = await signWithDevice({ privateJwk: other.privateJwk, data })  // firma de otra llave
  ep.send('tok-agent', { type: HS, data, signature, cert: await s.v.cert(stranger.publickey) })
  await wait(100)
  assert.equal(replies.at(-1)?.type, ERROR)
  assert.equal(s.asked.n, before, 'no se le preguntó a la bóveda')
  s.done()
})

test('makeThrottle: como mucho una vez por hueco, y lo de en medio se junta en una al final', async () => {
  let t = 0; let calls = 0; const timers = []
  const th = makeThrottle(async () => { calls++ }, { minGapMs: 1000, now: () => t, setTimer: (f, ms) => timers.push({ f, at: t + ms }) })
  th(); await Promise.resolve(); await Promise.resolve()
  assert.equal(calls, 1)
  for (let i = 0; i < 50; i++) th()
  assert.equal(timers.length, 1, 'un solo pendiente')
  t = 1000; timers[0].f(); await Promise.resolve(); await Promise.resolve()
  assert.equal(calls, 2)
})
