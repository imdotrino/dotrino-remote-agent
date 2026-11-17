/**
 * La clave de la máquina (src/access.js): el archivo, el freno por agente, el aviso por aparato y
 * el candado de cada sesión (`makeLock`). Las pruebas con sesiones de verdad viven en cada agente.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeGate, setAccessCode, clearAccessCode, hasAccessCode, checkAccessCode, ACCESS_FILE, FREE_TRIES } from '../src/access.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'access-'))

test('poner, comprobar y quitar; en el disco no queda la clave', () => {
  const dir = tmp()
  assert.throws(() => setAccessCode(dir, '123'), { code: 'too-short' })
  setAccessCode(dir, '4821')
  assert.equal(checkAccessCode(dir, '4821'), true)
  assert.equal(checkAccessCode(dir, '4822'), false)
  assert.ok(!fs.readFileSync(path.join(dir, ACCESS_FILE), 'utf8').includes('4821'))
  clearAccessCode(dir)
  assert.equal(hasAccessCode(dir), false)
})

test('tres fallos seguidos de UN aparato avisan una vez; acertar corta la racha', () => {
  const dir = tmp(); setAccessCode(dir, 'buena')
  const avisos = []
  let t = 0
  const g = makeGate(dir, { now: () => t, onIncident: (i) => avisos.push(i) })
  const falla = (dev) => { try { g.check('mala', dev); assert.fail('tenía que fallar') } catch (e) { return e } }
  // Dos aparatos distintos: los fallos se cuentan por aparato, el freno por agente.
  falla('A'); falla('B')
  // Tercer fallo del agente: empieza la espera local (bloqueo del servicio, nada más).
  const tercero = falla('A')
  assert.equal(tercero.code, 'bad-code')
  assert.ok(tercero.retryMs > 0, 'a los tres fallos del agente ya toca esperar')
  assert.equal(avisos.length, 0, 'A lleva dos: todavía no es incidente')
  t = tercero.retryMs + 1
  falla('A')
  assert.deepEqual(avisos, [{ device: 'A', tries: 3 }], 'avisa de A, que es quien lleva tres')
  t += 60 * 60_000
  falla('A')
  assert.equal(avisos.length, 1, 'no se repite en cada fallo')
  // Acierta: la racha de A se corta y el próximo tercer fallo vuelve a avisar.
  t += 2 * 60 * 60_000
  g.check('buena', 'A')
  falla('A'); falla('A'); falla('A')
  assert.equal(avisos.length, 2)
  // Sin aparato (la clave local) no hay a quién señalar.
  t += 60 * 60_000
  falla(null); falla(null); falla(null)
  assert.equal(avisos.length, 2)
})

test('makeLock: sin clave pasa; con clave, `locked` hasta escribirla bien', async () => {
  const { makeLock } = await import('../src/access.js')
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'))
  const sent = []
  const gate = makeGate(d)
  const lock = makeLock({ gate, device: 'dev', send: (m) => sent.push(m) })
  assert.equal(lock.mayPass(), true, 'sin clave')
  setAccessCode(d, '1234')
  assert.equal(lock.mayPass(), false)
  assert.equal(sent.at(-1).code, 'locked')
  assert.equal(lock.handle({ type: 'other' }), false)
  assert.equal(lock.handle({ type: 'unlock', code: 'nope' }), true)
  assert.equal(sent.at(-1).code, 'bad-code')
  lock.handle({ type: 'unlock', code: '1234' })
  assert.equal(sent.at(-1).type, 'unlocked')
  assert.equal(lock.mayPass(), true)
  assert.equal(makeLock({ gate: null, send: () => {} }).mayPass(), true, 'lo local no la pide')
  fs.rmSync(d, { recursive: true, force: true })
})

test('el freno es por agente: un candado nuevo no da intentos nuevos; sin poder leer el archivo nadie pasa', async () => {
  const { makeLock } = await import('../src/access.js')
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'))
  setAccessCode(d, '1234')
  const gate = makeGate(d)
  const sent = []
  for (let i = 0; i < FREE_TRIES; i++) makeLock({ gate, send: (m) => sent.push(m) }).handle({ type: 'unlock', code: 'x' })
  makeLock({ gate, send: (m) => sent.push(m) }).handle({ type: 'unlock', code: '1234' })
  assert.equal(sent.at(-1).code, 'wait', 'hasta con la buena hay que esperar')
  fs.writeFileSync(path.join(d, ACCESS_FILE), '{')
  const s2 = []
  assert.equal(makeLock({ gate: makeGate(d), send: (m) => s2.push(m) }).mayPass(), false)
  assert.equal(s2.at(-1).code, 'access-unreadable')
  fs.rmSync(d, { recursive: true, force: true })
})

test('lockCommand: estado y quitar sin terminal; poner sin terminal se para con no-tty', async () => {
  const { lockCommand } = await import('../src/access.js')
  const d = tmp(); const what = { es: 'usar el escritorio', en: 'use the desktop' }
  assert.match(await lockCommand({ dir: d, args: ['--status'], what }), /^Sin clave/)
  setAccessCode(d, '4821')
  assert.match(await lockCommand({ dir: d, args: ['--status'], what }), /^Hay clave/)
  assert.match(await lockCommand({ dir: d, args: ['--off'], what }), /quitada/)
  assert.equal(hasAccessCode(d), false)
  if (!process.stdin.isTTY) await assert.rejects(lockCommand({ dir: d, args: [], what }), { code: 'no-tty' })
  fs.rmSync(d, { recursive: true, force: true })
})
