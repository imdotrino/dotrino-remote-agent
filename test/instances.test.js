/**
 * Cada agente tiene su tipo, su nombre y su enlace, como `dotrino-env`. Lo que se fija:
 * sin nombre se busca y solo se exige con empate, y dos procesos no comparten enlace.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveInstance, listInstances, lockInstance } from '../src/instances.js'

function home () {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-home-'))
  process.env.DOTRINO_AGENT_HOME = d
  return path.join(d, 'ia-agent')
}
const enlazar = (root, n) => { fs.mkdirSync(path.join(root, n), { recursive: true }); fs.writeFileSync(path.join(root, n, 'link.json'), '{}') }

test('sin ninguno enlazado, el primero se llama default', () => {
  const root = home()
  assert.deepEqual(resolveInstance('ia-agent'), { name: 'default', dir: path.join(root, 'default') })
})

test('con uno solo, no hace falta nombrarlo', () => {
  const root = home(); enlazar(root, 'proyecto-a')
  assert.equal(resolveInstance('ia-agent').name, 'proyecto-a')
})

test('con dos, sin nombre se para y dice cuáles hay', () => {
  const root = home(); enlazar(root, 'proyecto-a'); enlazar(root, 'proyecto-b')
  assert.deepEqual(listInstances('ia-agent'), ['proyecto-a', 'proyecto-b'])
  assert.throws(() => resolveInstance('ia-agent'), /proyecto-a, proyecto-b/)
  assert.equal(resolveInstance('ia-agent', 'proyecto-b').name, 'proyecto-b')
})

test('un nombre que no es un segmento de ruta limpio se rechaza', () => {
  home()
  assert.throws(() => resolveInstance('ia-agent', '../fuera'), /invalid name/)
})

test('dos procesos no pueden usar el mismo enlace a la vez', () => {
  const root = home()
  const dir = path.join(root, 'default')
  fs.mkdirSync(dir, { recursive: true })
  // Un pid vivo que no es este: el del proceso padre.
  fs.writeFileSync(path.join(dir, 'agent.pid'), String(process.ppid))
  assert.throws(() => lockInstance(dir), /already running/)
  // Uno muerto no bloquea.
  fs.writeFileSync(path.join(dir, 'agent.pid'), '999999')
  const release = lockInstance(dir)
  assert.equal(fs.readFileSync(path.join(dir, 'agent.pid'), 'utf8'), String(process.pid))
  release()
  assert.equal(fs.existsSync(path.join(dir, 'agent.pid')), false)
})

test('cada tipo tiene su propia raíz: una terminal y un ia con el mismo nombre no chocan', () => {
  home()
  assert.notEqual(resolveInstance('ia-agent', 'default').dir, resolveInstance('terminal-agent', 'default').dir)
})
