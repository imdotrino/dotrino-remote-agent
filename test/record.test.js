/**
 * QUÉ ACTA SE DA POR BUENA. El acta decide quién abre sesión con el agente, así que estos
 * casos fijan la regla: solo entra una que encadena desde la de confianza, o —cuando aún no
 * hay ninguna— una firmada por la bóveda con la que se enroló la máquina.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeDeviceKey } from '@dotrino/identity/capabilities'
import { genesisActa, applyChanges, sealActa } from '@dotrino/identity/acta'
import { adoptRecord } from '../src/record.js'

const seal = (acta, k) => sealActa({ acta, privateJwk: k.privateJwk })

/** Una cuenta: su bóveda y una máquina con el agente, ya admitida. */
async function account () {
  const vault = await makeDeviceKey()
  const machine = await makeDeviceKey()
  let acta = await seal(genesisActa({ pub: vault.publickey, label: 'vault' }), vault)
  acta = await applyChanges(acta, [{ op: 'admit', member: { pub: machine.publickey, label: 'pc', caps: ['sign'] } }], { by: vault.publickey })
  acta = await seal(acta, vault)
  return { vault, machine, acta }
}

const admit = async (acta, by, pub) => seal(await applyChanges(acta, [{ op: 'admit', member: { pub, label: 'x', caps: ['sign'] } }], { by: by.publickey }), by)

test('sin acta de confianza: entra la que firmó la bóveda del enlace y nombra a la máquina', async () => {
  const { vault, machine, acta } = await account()
  const link = { iss: vault.publickey, cert: { seq: acta.seq } }
  const r = await adoptRecord({ link, candidate: acta, me: machine.publickey })
  assert.deepEqual(r, { adopt: true, reason: 'sealed-by-pinned-vault' })
})

test('sin acta de confianza: la de OTRA cuenta no entra, aunque nombre a la bóveda y a la máquina', async () => {
  const { vault, machine, acta } = await account()
  const other = await makeDeviceKey()
  let foreign = await seal(genesisActa({ pub: other.publickey, label: 'other' }), other)
  foreign = await seal(await applyChanges(foreign, [
    { op: 'admit', member: { pub: vault.publickey, label: 'v', caps: ['sign', 'sealer'] } },
    { op: 'admit', member: { pub: machine.publickey, label: 'pc', caps: ['sign'] } }
  ], { by: other.publickey }), other)
  const link = { iss: vault.publickey, cert: { seq: acta.seq } }
  const r = await adoptRecord({ link, candidate: foreign, me: machine.publickey })
  assert.deepEqual(r, { adopt: false, reason: 'not-sealed-by-pinned-vault' })
})

test('un acta guardada por una versión anterior NO cuenta como de confianza', async () => {
  const { vault, machine, acta } = await account()
  const other = await makeDeviceKey()
  const foreign = await seal(genesisActa({ pub: other.publickey, label: 'other' }), other)
  // `link.acta` existe pero sin `actaTrusted`: se juzga como si no hubiera ninguna.
  const link = { iss: vault.publickey, cert: { seq: acta.seq }, acta: foreign }
  assert.equal((await adoptRecord({ link, candidate: acta, me: machine.publickey })).adopt, true)
})

test('sin acta de confianza: no entra una anterior al papel, ni una que no nombra a la máquina', async () => {
  const { vault, machine, acta } = await account()
  const link = { iss: vault.publickey, cert: { seq: acta.seq + 5 } }
  assert.equal((await adoptRecord({ link, candidate: acta, me: machine.publickey })).reason, 'older-than-cert')
  const stranger = await makeDeviceKey()
  assert.equal((await adoptRecord({ link: { iss: vault.publickey, cert: { seq: 0 } }, candidate: acta, me: stranger.publickey })).reason, 'not-a-member')
})

test('con acta de confianza: la siguiente entra solo si encadena', async () => {
  const { vault, machine, acta } = await account()
  const link = { iss: vault.publickey, cert: { seq: acta.seq }, acta, actaTrusted: true }
  const next = await admit(acta, vault, (await makeDeviceKey()).publickey)
  assert.equal((await adoptRecord({ link, candidate: next, me: machine.publickey })).adopt, true)

  // Otra cuenta, con un `seq` enorme: no es este perfil.
  const other = await makeDeviceKey()
  const foreign = { ...(await seal(genesisActa({ pub: other.publickey, label: 'o' }), other)) }
  assert.equal((await adoptRecord({ link, candidate: foreign, me: machine.publickey })).adopt, false)

  // La misma cuenta, firmada por un miembro que no sella.
  const forged = await sealActa({ acta: { ...next, sealedBy: machine.publickey, sig: undefined }, privateJwk: machine.privateJwk }).catch(() => null)
  if (forged) assert.equal((await adoptRecord({ link, candidate: forged, me: machine.publickey })).adopt, false)
})

test('con acta de confianza: nunca hacia atrás', async () => {
  const { vault, machine, acta } = await account()
  const next = await admit(acta, vault, (await makeDeviceKey()).publickey)
  const link = { iss: vault.publickey, cert: { seq: acta.seq }, acta: next, actaTrusted: true }
  assert.deepEqual(await adoptRecord({ link, candidate: acta, me: machine.publickey }), { adopt: false, reason: 'seq-menor' })
})

test('sin bóveda fijada no se adopta nada', async () => {
  const { machine, acta } = await account()
  assert.equal((await adoptRecord({ link: {}, candidate: acta, me: machine.publickey })).reason, 'no-pinned-vault')
})
