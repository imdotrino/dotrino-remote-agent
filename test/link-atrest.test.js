/**
 * EL ENLACE VA CIFRADO EN REPOSO (0.30.0): lleva la llave privada del aparato. Se prueba que
 * en el disco no queda nada en claro, que un enlace viejo en claro se reescribe cifrado al
 * leerlo, y que uno que no se puede abrir LANZA en vez de pasar por «no hay enlace» (con eso,
 * el túnel crearía otra identidad encima de la que ya era).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeDeviceKey } from '@dotrino/identity/capabilities'
import { saveLink, loadLink, selfLink } from '../src/link.js'

const sample = async () => ({ device: await makeDeviceKey({ label: 'bot' }), cert: { seq: 1 }, iss: '{"kty":"EC"}', label: 'bot', at: 1 })

test('saveLink no deja la llave privada en claro, y loadLink la devuelve igual', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ra-atrest-'))
  try {
    const link = await sample()
    saveLink(dir, link)
    const raw = fs.readFileSync(path.join(dir, 'link.json'), 'utf8')
    assert.ok(!raw.includes(link.device.privateJwk.d), 'la privada no está en el archivo')
    assert.ok(!raw.includes('"d"'), 'ningún JWK privado en claro')
    assert.deepEqual(loadLink(dir), link)
    assert.equal(fs.statSync(path.join(dir, 'link.json')).mode & 0o777, 0o600)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('un enlace viejo en claro se lee y queda cifrado', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ra-atrest-'))
  try {
    const link = await sample()
    fs.writeFileSync(path.join(dir, 'link.json'), JSON.stringify(link, null, 2), { mode: 0o600 })
    assert.deepEqual(loadLink(dir), link)
    const raw = fs.readFileSync(path.join(dir, 'link.json'), 'utf8')
    assert.ok(!raw.includes(link.device.privateJwk.d), 'tras leerlo ya no está en claro')
    assert.deepEqual(loadLink(dir), link, 'y se sigue leyendo')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('sin enlace es null; un enlace que no se puede abrir LANZA', async () => {
  const a = await mkdtemp(path.join(tmpdir(), 'ra-atrest-'))
  const b = await mkdtemp(path.join(tmpdir(), 'ra-atrest-'))
  try {
    assert.equal(loadLink(a), null)
    await selfLink({ dir: a })
    // Copiado a otra carpeta (otro salt = otra máquina, a efectos del cifrado).
    fs.copyFileSync(path.join(a, 'link.json'), path.join(b, 'link.json'))
    assert.throws(() => loadLink(b), (e) => e.code === 'link-unreadable')
    fs.writeFileSync(path.join(a, 'link.json'), 'esto no es un enlace')
    assert.throws(() => loadLink(a), (e) => e.code === 'link-unreadable')
  } finally { await rm(a, { recursive: true, force: true }); await rm(b, { recursive: true, force: true }) }
})
