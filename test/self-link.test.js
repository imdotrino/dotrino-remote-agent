/**
 * UNA IDENTIDAD PROPIA, SIN BÓVEDA (`selfLink`): el aparato crea sus llaves y un génesis
 * autofirmado. Lo que se prueba es lo que importa a un extraño: que `verifySignedFor` acepta
 * lo que firma, a nombre de una cuenta cuyo id es su propia llave.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { verifySignedFor } from '@dotrino/identity/assertion'
import { selfLink, isSelfLink, loadLink, identityFromLink, refreshChain, renewLink } from '../src/link.js'

test('selfLink: llaves propias y génesis autofirmado, guardados en el enlace', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ra-self-'))
  try {
    const link = await selfLink({ label: 'tunnel', dir })
    assert.ok(isSelfLink(link))
    assert.deepEqual(loadLink(dir), link)
    assert.equal(link.sealerChain.length, 1)
    assert.equal(link.sealerChain[0].profileId, link.device.publickey)
    assert.ok(link.enc.publickey && link.enc.privateJwk, 'también la llave de cifrado')
    assert.equal(link.cert, undefined)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('lo que firma una identidad propia lo acepta verifySignedFor', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ra-self-'))
  try {
    const link = await selfLink({ label: 'tunnel', dir })
    const id = identityFromLink(link, { dir })
    const aud = 'https://r.dotrino.com'
    const body = { aud, iat: Date.now(), exp: Date.now() + 60_000, op: 'hello' }
    const s = await id.signData(body)
    const v = await verifySignedFor({ data: body, signature: s.signature, publickey: s.publickey, chain: s.chain, audience: aud })
    assert.equal(v.ok, true, v.reason)
    assert.equal(v.profileId, link.device.publickey)
    const st = await id.vaultStatus()
    assert.equal(st.paired, false)
    assert.equal(st.self, true)
    await assert.rejects(id.listVaultDevices(), (e) => e.code === 'no-vault')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('una identidad propia no pregunta a ninguna bóveda', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ra-self-'))
  try {
    const link = await selfLink({ dir })
    assert.deepEqual(await refreshChain(link, { dir }), { ok: true, seq: 1, self: true })
    assert.equal((await renewLink(link, { dir })).renewed, false)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('un enlace propio sin génesis no es una identidad', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ra-self-'))
  try {
    const link = await selfLink({ dir })
    assert.throws(() => identityFromLink({ ...link, sealerChain: [] }, { dir }), /genesis required/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
