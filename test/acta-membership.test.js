/**
 * SOLO APARATOS DEL ACTA, EN LAS DOS PUNTAS (auditoría del 2026-10-23).
 *
 * El papel (`cert`) no caduca: el de un aparato que el dueño quitó sigue bien firmado. Por eso
 * no basta con comprobar quién lo emitió; el acta vigente tiene que nombrar al aparato.
 *
 *   · el CLIENTE no abre sesión con una máquina quitada del acta, ni con otra llave de la
 *     cuenta que diga ser esa máquina (con un relevo que le pase el saludo);
 *   · el AGENTE cierra la sesión abierta de quien sale del acta, en cuanto se entera.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeDeviceKey, signDelegationWith, signWithDevice } from '@dotrino/identity/capabilities'
import { genesisActa, applyChanges, sealActa } from '@dotrino/identity/acta'
import { RemoteAgentClient } from '../src/client.js'
import { startRemoteAgent } from '../src/agent.js'
import { canGreet } from '../src/membership.js'
import { HS, ACK, ERROR, VMSG } from '../protocol.js'
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
    admit: (pub, label) => change({ op: 'admit', member: { pub, label, cn: null, caps: ['sign'] } }),
    remove: (pub) => change({ op: 'remove', pub }),
    async cert (sub) { return signDelegationWith(pair.privateKey, iss, { sub, scope: ['vault:sign'], iat: Date.now(), seq: acta.seq, nonce: crypto.randomUUID() }) }
  }
}

/** Lo que contestaría un agente: un ack firmado por `signer`, que dice ser `machine`. */
async function ackFrom ({ signer, machine, cert, eph }) {
  const seph = await makeEphemeral()
  const sid = 'a'.repeat(32)
  const ack = { op: ACK, sid, seph: seph.pub, ceph: eph.pub, machine, publickey: signer.publickey, ts: Date.now() }
  const { signature } = await signWithDevice({ privateJwk: signer.privateJwk, data: ack })
  return { sid, ack, signature, cert }
}

const clientFor = (v, me, agentPubkey) =>
  new RemoteAgentClient({ id: { me: { publickey: me.publickey }, listVaultDevices: async () => ({ acta: v.acta }) }, iss: v.iss }, { agentPubkey })

test('canGreet: el acta lo nombra y le da `sign`; sin acta, no', async () => {
  const v = await vault(); const a = await makeDeviceKey()
  assert.equal(canGreet(v.acta, a.publickey), false)
  await v.admit(a.publickey, 'a')
  assert.equal(canGreet(v.acta, a.publickey), true)
  assert.equal(canGreet(null, a.publickey), false)
})

test('cliente: la máquina de la cuenta, con su papel, abre sesión', async () => {
  const v = await vault(); const machine = await makeDeviceKey(); const me = await makeDeviceKey()
  await v.admit(machine.publickey, 'pc'); await v.admit(me.publickey, 'tel')
  const rc = clientFor(v, me, machine.publickey)
  const eph = await makeEphemeral()
  await rc._checkAck(await ackFrom({ signer: machine, machine: machine.publickey, cert: await v.cert(machine.publickey), eph }), eph)
  assert.ok(rc.key, 'con la llave de sesión')
})

test('cliente: una máquina QUITADA del acta no abre sesión, aunque su papel siga firmado', async () => {
  const v = await vault(); const machine = await makeDeviceKey(); const me = await makeDeviceKey()
  await v.admit(machine.publickey, 'pc'); await v.admit(me.publickey, 'tel')
  const oldCert = await v.cert(machine.publickey)
  await v.remove(machine.publickey)
  const rc = clientFor(v, me, machine.publickey)
  const eph = await makeEphemeral()
  await assert.rejects(rc._checkAck(await ackFrom({ signer: machine, machine: machine.publickey, cert: oldCert, eph }), eph), { code: 'unauthorized', reason: 'not-in-record' })
  assert.equal(rc.key, null)
})

test('cliente: otra llave de la cuenta que DICE ser la máquina no abre sesión', async () => {
  const v = await vault(); const machine = await makeDeviceKey(); const me = await makeDeviceKey(); const other = await makeDeviceKey()
  await v.admit(machine.publickey, 'pc'); await v.admit(me.publickey, 'tel'); await v.admit(other.publickey, 'bot')
  const rc = clientFor(v, me, machine.publickey)
  const eph = await makeEphemeral()
  await assert.rejects(rc._checkAck(await ackFrom({ signer: other, machine: machine.publickey, cert: await v.cert(other.publickey), eph }), eph), { code: 'unauthorized', reason: 'wrong-agent' })
  assert.equal(rc.key, null)
})

test('cliente: el acta se vuelve a pedir en cada saludo (una pestaña vive días)', async () => {
  const v = await vault(); const machine = await makeDeviceKey(); const me = await makeDeviceKey()
  await v.admit(machine.publickey, 'pc'); await v.admit(me.publickey, 'tel')
  const cert = await v.cert(machine.publickey)
  const rc = clientFor(v, me, machine.publickey)
  const eph = await makeEphemeral()
  await rc._checkAck(await ackFrom({ signer: machine, machine: machine.publickey, cert, eph }), eph)
  await v.remove(machine.publickey)
  const eph2 = await makeEphemeral()
  await assert.rejects(rc._checkAck(await ackFrom({ signer: machine, machine: machine.publickey, cert, eph: eph2 }), eph2), { reason: 'not-in-record' })
})

test('cliente: sin acta no se decide que sí', async () => {
  const v = await vault(); const machine = await makeDeviceKey(); const me = await makeDeviceKey()
  await v.admit(machine.publickey, 'pc')
  const rc = new RemoteAgentClient({ id: { me: { publickey: me.publickey }, listVaultDevices: async () => { throw new Error('offline') } }, iss: v.iss }, { agentPubkey: machine.publickey })
  const eph = await makeEphemeral()
  await assert.rejects(rc._checkAck(await ackFrom({ signer: machine, machine: machine.publickey, cert: await v.cert(machine.publickey), eph }), eph), { reason: 'no-record' })
})

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

test('agente: quien sale del acta pierde su sesión abierta en cuanto llega el aviso', async () => {
  const v = await vault(); const b = bus()
  const machine = await makeDeviceKey(); const laptop = await makeDeviceKey()
  await v.admit(machine.publickey, 'pc'); await v.admit(laptop.publickey, 'laptop')
  const link = { device: machine, cert: await v.cert(machine.publickey), acta: v.acta, actaSeq: v.acta.seq, actaTrusted: true, iss: v.iss, proxy: 'wss://bus.invalid', label: 'pc', at: Date.now() }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-evict-'))
  fs.writeFileSync(path.join(dir, 'link.json'), JSON.stringify(link))
  const vaultEp = b.endpoint('tok-vault')
  vaultEp.on('message', (from, p) => { if (p?.type === VMSG.DEVICES) vaultEp.send(from, { type: VMSG.DEVICES_RESULT, devices: [], revoked: [], blocked: [], acta: v.acta }) })
  await vaultEp.identifyAs({ publickey: v.iss })
  const sessions = []
  const agent = await startRemoteAgent({ dir, quiet: true, client: b.endpoint('tok-agent'), onSession: (s) => sessions.push(s) })
  await wait(50)

  const laptopEp = b.endpoint('tok-laptop')
  const replies = []
  laptopEp.on('message', (_f, p) => replies.push(p))
  const eph = await makeEphemeral()
  const data = { op: HS, eph: eph.pub, publickey: laptop.publickey, ts: Date.now() }
  const { signature } = await signWithDevice({ privateJwk: laptop.privateJwk, data })
  laptopEp.send('tok-agent', { type: HS, data, signature, cert: await v.cert(laptop.publickey) })
  await wait(100)
  assert.equal(replies.at(-1).type, ACK)
  let closed = false
  sessions[0].on('close', () => { closed = true })

  // Un aviso FALSO (un acta que no sella la bóveda) no cierra nada.
  const forger = await makeDeviceKey()
  laptopEp.sendByPubkey(machine.publickey, { type: 'vault.admin.event', body: { ev: 'removed' }, acta: { ...v.acta, seq: v.acta.seq + 1, members: v.acta.members.filter((m) => m.pub !== laptop.publickey), sealedBy: forger.publickey } })
  await wait(100)
  assert.equal(closed, false, 'un acta sin la firma de la bóveda no se adopta')

  // La bóveda quita el portátil y avisa con el acta nueva: la sesión se cierra y se le dice.
  await v.remove(laptop.publickey)
  vaultEp.sendByPubkey(machine.publickey, { type: 'vault.admin.event', body: { ev: 'removed' }, acta: v.acta })
  await wait(150)
  assert.equal(closed, true, 'la sesión del aparato quitado se cierra')
  const err = replies.find((p) => p.type === ERROR && p.reason === 'not-in-record')
  assert.ok(err, 'y se le avisa por qué')
  assert.equal(err.sid, sessions[0].sid)
  agent.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('Node: `listVaultDevices` no devuelve un acta que llegó por la red sin comprobarla', async () => {
  const { checkedActa } = await import('../src/link.js')
  const v = await vault(); const machine = await makeDeviceKey(); const forger = await makeDeviceKey()
  await v.admit(machine.publickey, 'pc')
  const trusted = v.acta
  const link = { iss: v.iss, cert: await v.cert(machine.publickey), acta: trusted, actaTrusted: true }
  const forged = { ...trusted, seq: trusted.seq + 1, members: [...trusted.members, { pub: forger.publickey, caps: ['sign', 'sealer'] }], sealedBy: forger.publickey }
  assert.equal(await checkedActa(link, forged, machine.publickey), trusted, 'la falsa no: queda la de confianza')
  await v.admit(forger.publickey, 'nuevo')
  assert.equal(await checkedActa(link, v.acta, machine.publickey), v.acta, 'la que encadena, sí')
  assert.equal(await checkedActa({ iss: v.iss, cert: link.cert }, forged, machine.publickey), null, 'sin acta de confianza y con una falsa: nada')
})
