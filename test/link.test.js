/**
 * La identidad de un agente a partir de su enlace: lo que un cliente del ecosistema
 * espera como `link.id`. Lo que se prueba es que FIRMA con la llave del aparato y que
 * la firma la acepta `verifyDeviceSig` con esa misma pública — es decir, que un agente
 * Node puede hacer `identify`/handshake igual que una app.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { makeDeviceKey, verifyDeviceSig } from '@dotrino/identity/capabilities'
import { identityFromLink, clientLink, saveLink, loadLink } from '../src/link.js'

test('identityFromLink firma con la llave del aparato y expone lo que piden los clientes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ra-link-'))
  try {
    const device = await makeDeviceKey({ label: 'bot' })
    const link = { device, enc: { publickey: 'x', privateJwk: {} }, cert: { exp: Date.now() + 1000, scope: ['vault:sign'] }, iss: '{"kty":"EC"}', proxy: 'wss://p', label: 'bot', at: 1 }
    saveLink(dir, link)
    assert.deepEqual(loadLink(dir), link)

    const id = identityFromLink(link, { dir })
    assert.equal(id.me.publickey, device.publickey)
    const data = { op: 'identify', ts: 1 }
    const { signature, publickey } = await id.signData(data)
    assert.equal(publickey, device.publickey)
    assert.ok(await verifyDeviceSig({ publickey: device.publickey, data, signature }))
    assert.deepEqual(await id.getVaultCert(), { cert: link.cert })
    const st = await id.vaultStatus()
    assert.equal(st.paired, true); assert.equal(st.master, link.iss); assert.equal(st.proxy, 'wss://p')

    const cl = clientLink(link, { dir })
    assert.equal(cl.iss, link.iss); assert.equal(cl.proxy, 'wss://p'); assert.equal(cl.cert, link.cert); assert.equal(cl.id.me.publickey, device.publickey)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('identityFromLink rechaza un enlace sin llave/cert/iss', () => {
  assert.throws(() => identityFromLink({}), /invalid link/)
})
