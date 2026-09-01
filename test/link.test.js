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
import { identityFromLink, clientLink, saveLink, loadLink, renewLink } from '../src/link.js'

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

/**
 * CUÁNDO SE PIDE PAPEL NUEVO, ahora que el papel no vence por reloj.
 *
 * Dos motivos y ninguno es el calendario: que el nuestro sea del MODELO VIEJO (lleva `exp`
 * y no `seq`: se acepta por el repliegue de migración pero muere en su fecha), o que el
 * acta que hemos visto vaya por delante del papel (el dueño cambió permisos).
 */
test('renewLink: se renueva un papel del modelo viejo y uno atrasado; no uno al día', async () => {
  const device = await makeDeviceKey({ label: 'bot' })

  // Al día: mismo `seq` que el acta que hemos visto. No hay nada que pedir.
  const alDia = { device, cert: { seq: 9 }, actaSeq: 9, iss: 'x', proxy: 'wss://p' }
  assert.deepEqual(await renewLink(alDia, { dir: '/nonexistent' }), { renewed: false, seq: 9, reason: 'not due' })

  // Del modelo viejo: se intenta (falla por la red, que es lo que se puede comprobar aquí),
  // y lo que importa es que NO conteste «not due» — eso era lo que dejaba la migración a
  // medias para siempre.
  const viejo = { device, cert: { exp: Date.now() + 20 * 86400000 }, iss: 'x', proxy: 'wss://p' }
  assert.notEqual((await renewLink(viejo, { dir: '/nonexistent' })).reason, 'not due')

  // Ya vencido: ahí no hay renovación que valga, toca re-emparejar.
  const muerto = { device, cert: { exp: Date.now() - 1 }, iss: 'x', proxy: 'wss://p' }
  assert.equal((await renewLink(muerto, { dir: '/nonexistent' })).reason, 'expired: enroll again')

  // Atrasado respecto del acta: también se intenta.
  const atras = { device, cert: { seq: 3 }, actaSeq: 8, iss: 'x', proxy: 'wss://p' }
  assert.notEqual((await renewLink(atras, { dir: '/nonexistent' })).reason, 'not due')
})
