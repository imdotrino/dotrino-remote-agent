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

const YO = '{"kty":"EC","x":"yo"}'
const NODE = '{"kty":"EC","x":"node"}'
const TEL = '{"kty":"EC","x":"telefono"}'
const NAV = '{"kty":"EC","x":"navegador"}'

/** Una identidad de mentira con lo justo que mira `listAgentsByLabel`. */
const identidad = ({ acta, devices = [] }) => ({
  me: { publickey: YO },
  listVaultDevices: async () => ({ devices, acta }),
  profileActa: async () => ({ acta })
})

const acta = {
  seq: 9,
  members: [
    { pub: YO, label: 'eco', cn: 'eco' },
    { pub: NODE, label: 'content', cn: 'content' },
    { pub: TEL, label: 'mi teléfono', cn: null },
    { pub: NAV, label: 'cli', cn: null }
  ]
}

test('un servicio encuentra el node aunque su inventario de aparatos venga VACÍO', async () => {
  // Exactamente lo que le contesta la bóveda desde 0.75.1: el acta sí, el inventario no.
  const found = await listAgentsByLabel(identidad({ acta, devices: [] }), 'content')
  assert.deepEqual(found.map((a) => a.sub), [NODE])
})

test('no se devuelve uno mismo: hablarse solo no es descubrir a nadie', async () => {
  const found = await listAgentsByLabel(identidad({ acta }), 'eco')
  assert.deepEqual(found, [])
})

test('sin label: todos los que tienen nombre menos los navegadores (`cli`)', async () => {
  const found = await listAgentsByLabel(identidad({ acta }), undefined)
  assert.deepEqual(found.map((a) => a.sub).sort(), [NODE, TEL].sort())
})

test('sin acta no se inventa nada: lista vacía', async () => {
  const id = { me: { publickey: YO }, listVaultDevices: async () => ({ devices: [] }), profileActa: async () => null }
  assert.deepEqual(await listAgentsByLabel(id, 'content'), [])
})

test('si la bóveda no contesta, se usa el acta que ya se tiene guardada', async () => {
  const id = {
    me: { publickey: YO },
    listVaultDevices: async () => { throw new Error('this device is not paired with a vault') },
    profileActa: async () => ({ acta })
  }
  assert.deepEqual((await listAgentsByLabel(id, 'content')).map((a) => a.sub), [NODE])
})
