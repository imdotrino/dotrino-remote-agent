/**
 * LOS MENSAJES DE UNA SESIÓN LLEGAN EN EL ORDEN EN QUE SE MANDARON.
 *
 * Cifrar y descifrar tardan según el tamaño. Sin cola, un mensaje pequeño adelantaba a uno
 * grande pedido antes: en la terminal, lo que una consola pintaba tras engancharse llegaba antes
 * que su pantalla inicial (cientos de KB), y esta lo tapaba después con algo ya viejo.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentSession } from '../src/agent.js'
import { open, seal } from '../e2e.js'

const key = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
const BIG = 'x'.repeat(4 * 1024 * 1024)

test('send: uno grande y después uno pequeño salen en ese orden', async () => {
  const k = await key()
  const sent = []
  const s = new AgentSession({ sid: 's', key: k, from: 't', device: 'd', send: (_to, obj) => sent.push(obj) })
  const a = s.send({ n: 1, data: BIG })
  const b = s.send({ n: 2 })
  await Promise.all([a, b])
  const got = []
  for (const m of sent) got.push((await open(k, m.env)).n)
  assert.deepEqual(got, [1, 2])
})

test('_ingest: uno grande y después uno pequeño se entregan en ese orden', async () => {
  const k = await key()
  const s = new AgentSession({ sid: 's', key: k, from: 't', device: 'd', send: () => {} })
  const got = []
  s.on('message', (m) => got.push(m.n))
  const [big, small] = [await seal(k, { n: 1, data: BIG }), await seal(k, { n: 2 })]
  await Promise.all([s._ingest(big), s._ingest(small)])
  assert.deepEqual(got, [1, 2])
})

test('un sobre que no abre no para la cola: lo siguiente se entrega', async () => {
  const k = await key()
  const s = new AgentSession({ sid: 's', key: k, from: 't', device: 'd', send: () => {} })
  const got = []
  s.on('message', (m) => got.push(m.n))
  const bad = await seal(await key(), { n: 0 })
  await Promise.all([s._ingest(bad), s._ingest(await seal(k, { n: 2 }))])
  assert.deepEqual(got, [2])
})
