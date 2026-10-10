/**
 * A QUIÉN LE PUEDO HABLAR: lo dice el ACTA, no el inventario del dueño.
 *
 * El 2026-08-31 (vaultd 0.75.1) un servicio pasó a recibir sus revocaciones y el acta pero
 * **no la lista de aparatos** del dueño: no es asunto suyo. `listAgentsByLabel` seguía
 * preguntando por ahí, así que a todo servicio le contestaba una lista vacía y concluía
 * «no tienes ninguno». El bot social estuvo veinte horas reintentando cada minuto contra un
 * node de contenido que estaba encendido a su lado.
 *
 * Estos casos fijan la distinción para que no se vuelva a cruzar: **el acta manda, y el
 * inventario vacío no significa nada.**
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { listAgentsByLabel } from '../src/discover.js'

const ME = '{"kty":"EC","x":"yo"}'
const NODE = '{"kty":"EC","x":"node"}'
const PHONE = '{"kty":"EC","x":"telefono"}'
const BROWSER = '{"kty":"EC","x":"navegador"}'

/** Una fakeIdentity de mentira con lo justo que mira `listAgentsByLabel`. */
const fakeIdentity = ({ acta, devices = [] }) => ({
  me: { publickey: ME },
  listVaultDevices: async () => ({ devices, acta }),
  profileActa: async () => ({ acta })
})

const acta = {
  seq: 9,
  members: [
    { pub: ME, label: 'eco', cn: 'eco' },
    { pub: NODE, label: 'content', cn: 'content' },
    { pub: PHONE, label: 'mi teléfono', cn: null },
    { pub: BROWSER, label: 'cli', cn: null }
  ]
}

test('un servicio encuentra el node aunque su inventario de aparatos venga VACÍO', async () => {
  // Exactamente lo que le contesta la bóveda desde 0.75.1: el acta sí, el inventario no.
  const found = await listAgentsByLabel(fakeIdentity({ acta, devices: [] }), 'content')
  assert.deepEqual(found.map((a) => a.sub), [NODE])
})

test('no se devuelve uno mismo: hablarse solo no es descubrir a nadie', async () => {
  const found = await listAgentsByLabel(fakeIdentity({ acta }), 'eco')
  assert.deepEqual(found, [])
})

test('sin label: todos los que tienen nombre menos los navegadores (`cli`)', async () => {
  const found = await listAgentsByLabel(fakeIdentity({ acta }), undefined)
  assert.deepEqual(found.map((a) => a.sub).sort(), [NODE, PHONE].sort())
})

test('sin acta no se sabe: se dice, no se contesta «ninguno»', async () => {
  const id = { me: { publickey: ME }, listVaultDevices: async () => ({ devices: [] }), profileActa: async () => null }
  await assert.rejects(listAgentsByLabel(id, 'content'), { code: 'no-acta' })
  // Y el motivo de la bóveda viaja en el mensaje: es lo que hay que arreglar.
  const mudo = { me: { publickey: ME }, listVaultDevices: async () => { throw new Error('the vault did not answer') }, profileActa: async () => null }
  await assert.rejects(listAgentsByLabel(mudo, 'content'), (e) => e.code === 'no-acta' && /the vault did not answer/.test(e.message))
})

test('si la bóveda no contesta, se usa el acta que ya se tiene guardada', async () => {
  const id = {
    me: { publickey: ME },
    listVaultDevices: async () => { throw new Error('this device is not paired with a vault') },
    profileActa: async () => ({ acta })
  }
  assert.deepEqual((await listAgentsByLabel(id, 'content')).map((a) => a.sub), [NODE])
})

// ---------- probeAgents: qué es cada uno lo dice el agente, no el nombre del acta ----------

import { probeAgents } from '../src/discover.js'

/** Un transporte de mentira: los `sub` de `kinds` contestan el ping con su kind. */
function fakeClient (kinds) {
  const handlers = []
  return {
    on (ev, cb) { handlers.push(cb); return () => { handlers.splice(handlers.indexOf(cb), 1) } },
    sendByPubkey (sub, p) {
      if (p.type !== 'ra.ping' || !(sub in kinds)) return
      setTimeout(() => { for (const h of [...handlers]) h('tok', { type: 'ra.pong', n: p.n, kind: kinds[sub] }) }, 5)
    }
  }
}

test('probeAgents: encuentra la terminal aunque el dueño la llamara «TerminalLocal»', async () => {
  const found = await probeAgents(fakeClient({ [NODE]: 'content', [PHONE]: 'terminal-agent' }), [NODE, PHONE, BROWSER], { timeoutMs: 100 })
  assert.equal(found.get(PHONE)?.kind, 'terminal-agent')
  assert.equal(found.get(NODE)?.kind, 'content')
  assert.equal(found.has(BROWSER), false, 'quien no contesta no sale: no se sabe qué es')
})

test('probeAgents: un agente viejo que contesta sin kind sale con kind null', async () => {
  const c = fakeClient({ [NODE]: undefined })
  const found = await probeAgents(c, [NODE], { timeoutMs: 100 })
  assert.equal(found.get(NODE)?.kind, null)
})

test('probeAgents: el ping es EFÍMERO — a quien no está no se le encola ni se le timbra', async () => {
  // El teléfono sonaba cada minuto sin ningún pedido: la app preguntaba a todos los aparatos
  // de la cuenta, y el proxio encolaba el ping del que no estaba conectado y le timbraba.
  const opciones = []
  const c = { on: () => () => {}, sendByPubkey: (_s, _p, o) => { opciones.push(o) } }
  await probeAgents(c, [NODE, PHONE], { timeoutMs: 10 })
  assert.equal(opciones.length, 2)
  assert.ok(opciones.every((o) => o?.ephemeral === true), JSON.stringify(opciones))
})
