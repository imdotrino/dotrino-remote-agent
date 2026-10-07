/**
 * Ante un rechazo, el agente se pone al día con la bóveda antes de decir que no: un aparato recién
 * emparejado no tiene por qué esperar al siguiente tic de 5 minutos. Con freno, y solo se vuelve a
 * juzgar si el acta avanzó.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeCatchUp } from '../src/catch-up.js'

test('si el acta avanza, dice que sí: vale la pena juzgar otra vez', async () => {
  let seq = 4
  const catchUp = makeCatchUp({ refresh: async () => { seq = 5 }, seq: () => seq })
  assert.equal(await catchUp(), true)
})

test('si la bóveda no trae nada nuevo, dice que no: el rechazo se queda', async () => {
  const catchUp = makeCatchUp({ refresh: async () => {}, seq: () => 4 })
  assert.equal(await catchUp(), false)
})

test('con freno: muchos saludos seguidos son UNA pregunta a la bóveda', async () => {
  let asked = 0; let t = 1000
  const catchUp = makeCatchUp({ refresh: async () => { asked++ }, seq: () => 4, now: () => t, minGapMs: 10_000 })
  await catchUp(); await catchUp(); t += 9_000; await catchUp()
  assert.equal(asked, 1)
  t += 2_000; await catchUp()
  assert.equal(asked, 2)
})

test('los que llegan mientras se pregunta esperan a esa misma respuesta', async () => {
  let seq = 4; let asked = 0
  const catchUp = makeCatchUp({ refresh: async () => { asked++; await new Promise((r) => setTimeout(r, 30)); seq = 5 }, seq: () => seq })
  const [a, b] = await Promise.all([catchUp(), catchUp()])
  assert.deepEqual([a, b, asked], [true, true, 1])
})

test('si la bóveda no contesta, no se juzga otra vez (y no se cae)', async () => {
  const catchUp = makeCatchUp({ refresh: async () => { throw new Error('vault-no-reply') }, seq: () => 4 })
  assert.equal(await catchUp(), false)
})
