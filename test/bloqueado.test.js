/**
 * UN APARATO BLOQUEADO NO ENTRA, y si estaba dentro se le cierra (dueño, 2026-10-07).
 *
 * El bloqueo lo decide un aprobador en la bóveda; al agente le llega con la lista de
 * revocados (`vault.devices.result.blocked`) y se guarda en el enlace, para seguir valiendo
 * con la bóveda apagada. Aquí la bóveda es un doble sobre un bus en memoria: contesta la
 * lista con un acta sellada de verdad, que es lo único que el agente comprueba.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeDeviceKey, signDelegationWith, signWithDevice } from '@dotrino/identity/capabilities'
import { genesisActa, applyChanges, sealActa } from '@dotrino/identity/acta'
import { startRemoteAgent } from '../src/agent.js'
import { HS, ACK, ERROR, VMSG } from '../protocol.js'
import { makeEphemeral } from '../e2e.js'

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

function bus () {
  const byToken = new Map(); const byPubkey = new Map()
  const deliver = (c, from, obj) => queueMicrotask(() => { for (const fn of c._h) fn(from, obj) })
  const endpoint = (token) => {
    const c = {
      token, url: 'wss://bus.invalid', _h: [],
      on (ev, fn) { if (ev !== 'message') return () => {}; c._h.push(fn); return () => { const i = c._h.indexOf(fn); if (i >= 0) c._h.splice(i, 1) } },
      async identifyAs ({ publickey, sign } = {}) { await sign?.({ op: 'identify', publickey, ts: Date.now() }); byPubkey.set(publickey, c); return { ok: true } },
      async identify ({ data } = {}) { if (data?.publickey) byPubkey.set(data.publickey, c); return { ok: true } },
      send (to, obj) { const t = byToken.get(to); if (t) deliver(t, token, obj) },
      sendByPubkey (pub, obj) { const t = byPubkey.get(pub); if (t) deliver(t, token, obj) },
      close () {}
    }
    byToken.set(token, c); return c
  }
  return { endpoint }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

test('bloqueado: no saluda, se le cierra la sesión abierta, y la lista sobrevive en el enlace', async () => {
  const v = await boveda(); const b = bus()
  const machine = await makeDeviceKey({ label: 'terminal' })
  const laptop = await makeDeviceKey({ label: 'laptop' })
  await v.admit(machine.publickey, 'terminal'); await v.admit(laptop.publickey, 'laptop')
  const link = { device: machine, cert: await v.cert(machine.publickey), acta: v.acta, actaSeq: v.acta.seq, actaTrusted: true, iss: v.iss, proxy: 'wss://bus.invalid', label: 'terminal', at: Date.now() }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-blocked-'))
  fs.writeFileSync(path.join(dir, 'link.json'), JSON.stringify(link))

  // La bóveda de mentira: contesta `devices` con la lista que se le diga, e `incident` con un id.
  const vaultEp = b.endpoint('tok-vault')
  let blocked = []
  const incidents = []
  vaultEp.on('message', (from, p) => {
    if (p?.type === VMSG.DEVICES) vaultEp.send(from, { type: VMSG.DEVICES_RESULT, devices: [], revoked: [], blocked, acta: v.acta })
    if (p?.type === VMSG.INCIDENT) { incidents.push(p.data); vaultEp.send(from, { type: VMSG.INCIDENT_RESULT, id: 'inc-1', approvers: 1, blocked: false }) }
  })
  await vaultEp.identifyAs({ publickey: v.iss })

  const sesiones = []
  const agent = await startRemoteAgent({ dir, quiet: true, client: b.endpoint('tok-agent'), onSession: (s) => sesiones.push(s) })
  await espera(50)

  // El portátil saluda y entra.
  const laptopEp = b.endpoint('tok-laptop')
  const respuestas = []
  laptopEp.on('message', (_f, p) => respuestas.push(p))
  const saludar = async () => {
    const eph = await makeEphemeral()
    const data = { op: HS, eph: eph.pub, publickey: laptop.publickey, ts: Date.now() }
    const { signature } = await signWithDevice({ privateJwk: laptop.privateJwk, data })
    laptopEp.send('tok-agent', { type: HS, data, signature, cert: await v.cert(laptop.publickey) })
    await espera(100)
    return respuestas[respuestas.length - 1]
  }
  assert.equal((await saludar()).type, ACK)
  assert.equal(sesiones.length, 1)
  let cerrada = false
  sesiones[0].on('close', () => { cerrada = true })

  // El agente reporta un incidente sobre el portátil: va firmado a la bóveda.
  const r = await agent.reportIncident({ kind: 'bad-code', about: laptop.publickey, tries: 3 })
  assert.deepEqual(r, { id: 'inc-1', approvers: 1, blocked: false })
  assert.equal(incidents[0].about, laptop.publickey)
  assert.equal(incidents[0].kind, 'bad-code')

  // El aprobador bloqueó: la bóveda avisa, el agente trae la lista y le cierra la sesión.
  blocked = [laptop.publickey]
  vaultEp.sendByPubkey(machine.publickey, { type: 'vault.admin.event', body: { ev: 'blocked', deviceId: 'XXXX-0000' }, acta: v.acta })
  await espera(100)
  assert.equal(cerrada, true, 'la sesión abierta se cierra en el acto')
  assert.equal(agent.isBlocked(laptop.publickey), true)
  const otra = await saludar()
  assert.equal(otra.type, ERROR)
  assert.equal(otra.code, 'blocked')
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'link.json'), 'utf8')).blocked, [laptop.publickey], 'persistido en el enlace')
  agent.close()

  // Sin bóveda: el agente arranca con la lista guardada y sigue cerrando la puerta.
  vaultEp._h.length = 0
  const agent2 = await startRemoteAgent({ dir, quiet: true, client: b.endpoint('tok-agent'), onSession: (s) => sesiones.push(s) })
  await espera(50)
  assert.equal(agent2.isBlocked(laptop.publickey), true)
  assert.equal((await saludar()).code, 'blocked')
  agent2.close()
  fs.rmSync(dir, { recursive: true, force: true })
})
