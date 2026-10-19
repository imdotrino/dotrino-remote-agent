/**
 * `checkCap`: la app que atiende la sesión pregunta si ESE aparato puede algo (p. ej. `admin`)
 * contra el acta de confianza del agente, no contra lo que diga el cliente. Si no pasa, se
 * trae el acta en el momento: un permiso recién concedido no espera al tic de cinco minutos.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeDeviceKey, signDelegationWith } from '@dotrino/identity/capabilities'
import { genesisActa, applyChanges, sealActa } from '@dotrino/identity/acta'
import { startRemoteAgent } from '../src/agent.js'
import { VMSG } from '../protocol.js'

async function vault () {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const iss = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey))
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  let acta = await sealActa({ acta: genesisActa({ pub: iss, label: 'vault' }), privateJwk })
  const change = async (ch) => { acta = await sealActa({ acta: await applyChanges(acta, [ch], { by: iss }), privateJwk }) }
  return {
    iss,
    get acta () { return acta },
    admit: (pub, caps) => change({ op: 'admit', member: { pub, label: 'x', cn: null, caps } }),
    caps: (pub, caps) => change({ op: 'caps', pub, caps }),
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

test('checkCap: dice si el aparato tiene el permiso en el acta, y trae el acta nueva antes de decir que no', async () => {
  const v = await vault(); const b = bus()
  const machine = await makeDeviceKey({ label: 'accounts' })
  const admin = await makeDeviceKey({ label: 'laptop' })
  const plain = await makeDeviceKey({ label: 'phone' })
  const stranger = await makeDeviceKey({ label: 'stranger' })
  await v.admit(machine.publickey, ['sign']); await v.admit(admin.publickey, ['sign']); await v.admit(plain.publickey, ['sign'])
  const link = { device: machine, cert: await v.cert(machine.publickey), acta: v.acta, actaSeq: v.acta.seq, actaTrusted: true, iss: v.iss, proxy: 'wss://bus.invalid', label: 'accounts', at: Date.now() }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-checkcap-'))
  fs.writeFileSync(path.join(dir, 'link.json'), JSON.stringify(link))

  const vaultEp = b.endpoint('tok-vault')
  vaultEp.on('message', (from, p) => {
    if (p?.type === VMSG.DEVICES) vaultEp.send(from, { type: VMSG.DEVICES_RESULT, devices: [], revoked: [], blocked: [], acta: v.acta })
    // Con el acta nueva el agente pide renovar su papel: aquí no se renueva, se dice que no. Sin
    // respuesta se quedaba esperando un temporizador `unref` y Node 20 daba la prueba por colgada.
    else if (p?.type === VMSG.RENEW) vaultEp.send(from, { type: VMSG.ERROR, error: 'renew is not part of this test' })
  })
  await vaultEp.identifyAs({ publickey: v.iss })
  const agent = await startRemoteAgent({ dir, quiet: true, client: b.endpoint('tok-agent') })
  await wait(50)

  // El dueño le da `admin` al portátil: el agente no lo sabe todavía, y al preguntar trae el acta.
  await v.caps(admin.publickey, ['sign', 'admin'])
  const r = await agent.checkCap(admin.publickey, 'admin')
  assert.equal(r.ok, true)
  assert.equal(r.seq, v.acta.seq)
  assert.equal(agent.record().seq, v.acta.seq, 'el acta nueva queda como la de confianza')

  assert.deepEqual(await agent.checkCap(plain.publickey, 'admin'), { ok: false, code: 'missing-cap' })
  assert.deepEqual(await agent.checkCap(stranger.publickey, 'admin'), { ok: false, code: 'not-in-record' })
  await assert.rejects(agent.checkCap(plain.publickey, ''), { code: 'bad-request' })
  agent.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('checkCap: sin acta de confianza no se sabe, y se dice (no-record)', async () => {
  const v = await vault(); const b = bus()
  const machine = await makeDeviceKey({ label: 'accounts' })
  await v.admit(machine.publickey, ['sign'])
  const link = { device: machine, cert: await v.cert(machine.publickey), iss: v.iss, proxy: 'wss://bus.invalid', label: 'accounts', at: Date.now() }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-checkcap-'))
  fs.writeFileSync(path.join(dir, 'link.json'), JSON.stringify(link))
  // Una bóveda que contesta sin acta: el agente sigue sin una de confianza.
  const vaultEp = b.endpoint('tok-vault')
  vaultEp.on('message', (from, p) => { if (p?.type === VMSG.DEVICES) vaultEp.send(from, { type: VMSG.DEVICES_RESULT, devices: [], revoked: [], blocked: [] }) })
  await vaultEp.identifyAs({ publickey: v.iss })
  const agent = await startRemoteAgent({ dir, quiet: true, client: b.endpoint('tok-agent') })
  await wait(50)
  assert.deepEqual(await agent.checkCap(machine.publickey, 'admin'), { ok: false, code: 'no-record' })
  assert.equal(agent.record(), null)
  agent.close()
  fs.rmSync(dir, { recursive: true, force: true })
})
