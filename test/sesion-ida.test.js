/**
 * LA CONEXIÓN DEL CLIENTE SE FUE: su sesión se cierra, no espera 30 minutos.
 *
 * Un teléfono que vuelve del fondo abre conexión y sesión nuevas. La vieja seguía en el agente
 * hasta vencer por inactividad, y lo que la app tuviera colgado de ella también (en la terminal:
 * una consola con seis mirones del mismo aparato, y el tamaño heredado por uno que ya no estaba).
 * El proxio avisa de que el token murió; si en el plazo no llega nada de esa sesión, se cierra.
 * Un cliente que reconecta y sigue con su sesión desde otro token se la queda.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeDeviceKey, signDelegationWith, signWithDevice } from '@dotrino/identity/capabilities'
import { genesisActa, applyChanges, sealActa } from '@dotrino/identity/acta'
import { startRemoteAgent } from '../src/agent.js'
import { HS, ACK, DATA, VMSG } from '../protocol.js'
import { makeEphemeral, deriveKey, seal } from '../e2e.js'

async function boveda () {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const iss = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey))
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey)
  let acta = await sealActa({ acta: genesisActa({ pub: iss, label: 'bóveda' }), privateJwk })
  return {
    iss,
    get acta () { return acta },
    async admit (pub, label) { acta = await sealActa({ acta: await applyChanges(acta, [{ op: 'admit', member: { pub, label, cn: null, caps: ['sign'] } }], { by: iss }), privateJwk }) },
    async cert (sub) { return signDelegationWith(pair.privateKey, iss, { sub, scope: ['vault:sign'], iat: Date.now(), seq: acta.seq, nonce: crypto.randomUUID() }) }
  }
}

/** Un bus en memoria que además avisa de una baja, como el proxio (`peer_disconnected`). */
function bus () {
  const byToken = new Map(); const byPubkey = new Map()
  const deliver = (c, from, obj) => queueMicrotask(() => { for (const fn of c._h.message) fn(from, obj) })
  const endpoint = (token) => {
    const c = {
      token, url: 'wss://bus.invalid', _h: { message: [], peer_disconnected: [] },
      on (ev, fn) { c._h[ev]?.push(fn); return () => {} },
      async identifyAs ({ publickey, sign } = {}) { await sign?.({ op: 'identify', publickey, ts: Date.now() }); byPubkey.set(publickey, c); return { ok: true } },
      send (to, obj) { const t = byToken.get(to); if (t) deliver(t, token, obj) },
      sendByPubkey (pub, obj) { const t = byPubkey.get(pub); if (t) deliver(t, token, obj) },
      close () {}
    }
    byToken.set(token, c); return c
  }
  /** La conexión `token` se cae: los demás se enteran. */
  const drop = (token) => {
    byToken.delete(token)
    for (const c of byToken.values()) for (const fn of c._h.peer_disconnected) fn(token, null)
  }
  return { endpoint, drop }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))
const GONE_MS = 150

async function montar () {
  const v = await boveda(); const b = bus()
  const machine = await makeDeviceKey({ label: 'terminal' })
  const phone = await makeDeviceKey({ label: 'teléfono' })
  await v.admit(machine.publickey, 'terminal'); await v.admit(phone.publickey, 'teléfono')
  const link = { device: machine, cert: await v.cert(machine.publickey), acta: v.acta, actaSeq: v.acta.seq, actaTrusted: true, iss: v.iss, proxy: 'wss://bus.invalid', label: 'terminal', at: Date.now() }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-gone-'))
  fs.writeFileSync(path.join(dir, 'link.json'), JSON.stringify(link))
  const vaultEp = b.endpoint('tok-vault')
  vaultEp.on('message', (from, p) => { if (p?.type === VMSG.DEVICES) vaultEp.send(from, { type: VMSG.DEVICES_RESULT, devices: [], revoked: [], blocked: [], acta: v.acta }) })
  await vaultEp.identifyAs({ publickey: v.iss })
  const sesiones = []
  const agent = await startRemoteAgent({ dir, quiet: true, sessionGoneMs: GONE_MS, client: b.endpoint('tok-agent'), onSession: (s) => sesiones.push(s) })
  await espera(50)

  /** Saluda desde `token` y devuelve con qué seguir hablando por esa sesión. */
  const saludar = async (token) => {
    const ep = b.endpoint(token)
    let ack = null
    ep.on('message', (_f, p) => { if (p?.type === ACK) ack = p })
    const eph = await makeEphemeral()
    const data = { op: HS, eph: eph.pub, publickey: phone.publickey, ts: Date.now() }
    const { signature } = await signWithDevice({ privateJwk: phone.privateJwk, data })
    ep.send('tok-agent', { type: HS, data, signature, cert: await v.cert(phone.publickey) })
    await espera(100)
    assert.ok(ack, 'el agente contestó el saludo')
    return { sid: ack.sid, key: await deriveKey(eph.privateKey, ack.ack.seph, ack.sid) }
  }
  const fin = () => { agent.close(); fs.rmSync(dir, { recursive: true, force: true }) }
  return { b, sesiones, saludar, fin }
}

test('la conexión se fue y no vuelve: la sesión se cierra pasado el plazo', async () => {
  const { b, sesiones, saludar, fin } = await montar()
  await saludar('tok-phone-1')
  let cerrada = false
  sesiones[0].on('close', () => { cerrada = true })
  b.drop('tok-phone-1')
  await espera(GONE_MS / 3)
  assert.equal(cerrada, false, 'no se cierra en el acto: puede estar reconectando')
  await espera(GONE_MS)
  assert.equal(cerrada, true)
  fin()
})

test('reconecta y sigue con su sesión desde otro token: se la queda', async () => {
  const { b, sesiones, saludar, fin } = await montar()
  const { sid, key } = await saludar('tok-phone-1')
  let cerrada = false
  const recibidos = []
  sesiones[0].on('close', () => { cerrada = true })
  sesiones[0].on('message', (m) => recibidos.push(m))
  b.drop('tok-phone-1')
  b.endpoint('tok-phone-2').send('tok-agent', { type: DATA, sid, env: await seal(key, { type: 'list' }) })
  await espera(GONE_MS * 2)
  assert.deepEqual(recibidos, [{ type: 'list' }])
  assert.equal(cerrada, false)
  assert.equal(sesiones[0].from, 'tok-phone-2')
  fin()
})

test('la baja de un token no toca las sesiones de otro', async () => {
  const { b, sesiones, saludar, fin } = await montar()
  await saludar('tok-phone-1')
  await saludar('tok-phone-2')
  const cerradas = []
  sesiones.forEach((s, i) => s.on('close', () => cerradas.push(i)))
  b.drop('tok-phone-1')
  await espera(GONE_MS * 2)
  assert.deepEqual(cerradas, [0])
  fin()
})
