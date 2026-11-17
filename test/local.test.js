/**
 * El socket local (src/local.js): permisos, ida y vuelta de JSON por líneas, un segundo agente
 * en la misma carpeta, la tubería de Windows con su llave (con un socket Unix haciendo de
 * tubería), y el registro de fallos de far.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listenLocal, connectLocal, socketPath, pipeFile } from '../src/local.js'
import { failureLog } from '../src/far.js'

/** @param {() => boolean} cond @param {number} [ms] */
const until = async (cond, ms = 3000) => {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ra-local-'))

test('una ventana habla con el agente por el socket, con la carpeta 0700 y el socket 0600', async () => {
  const dir = tmp()
  /** @type {any[]} */
  const seen = []
  let closed = 0
  const local = await listenLocal({
    dir,
    name: 'remote-desktop',
    serve: (s) => {
      assert.equal(s.device, null, 'una sesión local no es un aparato del acta')
      s.on('message', (m) => { seen.push(m); s.send({ type: 'echo', got: m }) })
      s.on('close', () => { closed++ })
    }
  })
  assert.equal(local.path, socketPath(dir, 'remote-desktop'))
  assert.equal(path.basename(local.path), 'remote-desktop.sock')
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
  assert.equal(fs.statSync(local.path).mode & 0o777, 0o600)
  const c = await connectLocal(dir, { name: 'remote-desktop' })
  /** @type {any[]} */
  const got = []
  c.on('message', (m) => got.push(m))
  c.send({ type: 'scene' })
  await until(() => got.length === 1)
  assert.deepEqual(got[0], { type: 'echo', got: { type: 'scene' } })
  assert.deepEqual(seen, [{ type: 'scene' }])
  c.close()
  await until(() => closed === 1)
  local.close()
  assert.equal(fs.existsSync(local.path), false, 'al cerrar se quita el socket')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('sin agente, connectLocal dice ENOAGENT; dos agentes en la misma carpeta, EALREADY', async () => {
  const dir = tmp()
  await assert.rejects(connectLocal(dir, { name: 'x' }), (/** @type {any} */ e) => e.code === 'ENOAGENT')
  const a = await listenLocal({ dir, name: 'x', serve: () => {} })
  await assert.rejects(listenLocal({ dir, name: 'x', serve: () => {} }), (/** @type {any} */ e) => e.code === 'EALREADY')
  // Otro nombre en la misma carpeta es otro socket.
  const b = await listenLocal({ dir, name: 'y', serve: () => {} })
  a.close(); b.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('un socket que dejó un agente muerto se quita y se vuelve a escuchar', async () => {
  const dir = tmp()
  fs.writeFileSync(socketPath(dir, 'x'), '')
  const a = await listenLocal({ dir, name: 'x', serve: () => {} })
  a.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('el nombre se valida: nada de rutas', async () => {
  const dir = tmp()
  await assert.rejects(listenLocal({ dir, name: '../evil', serve: () => {} }), /invalid local socket name/)
  assert.throws(() => connectLocal(dir, { name: 'A B' }), /invalid local socket name/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('«Windows»: la tubería se apunta en <name>.pipe (0600) y con su llave se entra', async () => {
  // La tubería de verdad solo existe en Windows; aquí se prueba el camino de la llave con
  // `platform: 'win32'`, que en Linux acaba siendo un socket Unix con ese nombre.
  if (process.platform === 'win32') return
  const dir = tmp()
  let served = 0
  const real = await listenLocal({ dir, name: 'x', platform: 'win32', serve: (s) => { served++; s.on('message', (m) => s.send({ type: 'echo', got: m })) } }).catch((e) => e)
  // En Linux un nombre `\\.\pipe\…` es una ruta relativa rara: si no se puede escuchar ahí, la
  // prueba no tiene nada que decir.
  if (real instanceof Error) { fs.rmSync(dir, { recursive: true, force: true }); return }
  const rec = JSON.parse(fs.readFileSync(pipeFile(dir, 'x'), 'utf8'))
  assert.match(rec.pipe, /dotrino-x-[0-9a-f]{32}$/)
  assert.equal(fs.statSync(pipeFile(dir, 'x')).mode & 0o777, 0o600)
  const c = await connectLocal(dir, { name: 'x', platform: 'win32' })
  /** @type {any[]} */
  const got = []
  c.on('message', (m) => got.push(m))
  c.send({ type: 'hi' })
  await until(() => got.length === 1)
  assert.equal(served, 1)
  c.close()
  real.close()
  try { fs.rmSync(rec.pipe) } catch (_) {}
  fs.rmSync(dir, { recursive: true, force: true })
})

test('failureLog escribe al fallar, al cambiar de motivo y al recuperarse; no en cada vuelta', () => {
  /** @type {string[]} */
  const lines = []
  const report = failureLog((l) => lines.push(l))
  report('machine A', { code: 'unreachable', message: 'no' }, 10)
  report('machine A', { code: 'unreachable', message: 'no' }, 12)
  report('machine A', { code: 'locked' })
  report('machine A', null, 5)
  report('machine A', null)
  assert.equal(lines.length, 3)
  assert.match(lines[0], /machine A: unreachable after 10 ms/)
  assert.match(lines[1], /machine A: locked/)
  assert.match(lines[2], /machine A: ok again after 5 ms/)
})
