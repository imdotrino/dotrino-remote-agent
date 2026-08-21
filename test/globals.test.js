/**
 * Los globales que un agente headless necesita.
 *
 * Existe por un fallo que no se veía: `installNodeGlobals` ASIGNABA
 * `globalThis.localStorage`, y desde Node 22 eso es un accesor nativo que rechaza la
 * asignación. En Node 25.9 el plano de control de cualquier agente moría al arrancar
 * con «Cannot assign to read only property 'localStorage'» — un mensaje que no dice
 * nada de lo que pasa y que solo aparece en la versión de Node que tenga cada uno.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { installNodeGlobals } from '../node-globals.js'

test('instalar los globales no revienta con el localStorage nativo de Node ≥22', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dra-'))
  // Node define `localStorage` como accesor: si esto se hiciera asignando, aquí
  // saltaría el TypeError. Que no salte ES la prueba.
  installNodeGlobals(dir)

  assert.equal(typeof globalThis.localStorage.getItem, 'function')
  assert.equal(typeof globalThis.WebSocket, 'function', 'y el WebSocket del paquete `ws`')

  globalThis.localStorage.setItem('k', 'v')
  assert.equal(globalThis.localStorage.getItem('k'), 'v')
  assert.equal(globalThis.localStorage.getItem('no-está'), null, 'lo que no está es null, no undefined')
  globalThis.localStorage.removeItem('k')
  assert.equal(globalThis.localStorage.getItem('k'), null)

  await rm(dir, { recursive: true, force: true })
})

test('el shim persiste en disco: el agente no pierde su llave de transporte al reiniciar', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'dra2-'))
  const { fileLocalStorage } = await import('../node-globals.js')
  const a = fileLocalStorage(path.join(dir, 'transport.json'))
  a.setItem('llave', 'secreta')

  const b = fileLocalStorage(path.join(dir, 'transport.json')) // otro arranque
  assert.equal(b.getItem('llave'), 'secreta')

  await rm(dir, { recursive: true, force: true })
})
