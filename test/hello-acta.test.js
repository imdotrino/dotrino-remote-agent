/**
 * QUIÉN PUEDE SALUDAR A UN AGENTE: el acta tiene que nombrarlo y darle `sign`. Y nada más.
 *
 * El guardián del handshake preguntaba con `memberCanSign(acta, device)` —sin cajón—, que
 * a un miembro CON `cn` le dice que no. Es correcto en su mostrador: un servicio habla por
 * la bóveda, no por su dueño. Pero aquí no se está pidiendo hablar por nadie: se está
 * probando «soy este aparato». Con esa pregunta, NINGÚN servicio podía abrir sesión con
 * otro agente — y el ecosistema está lleno de servicios que tienen que hacerlo (el bot
 * social contra el node de contenido, sin ir más lejos: se pasó así el 1 de septiembre).
 *
 * Lo que estos casos fijan es la frontera: se afloja lo que sobraba, NO lo que protegía.
 * Un aparato al que el acta ya no nombra sigue fuera, tenga el papel que tenga.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memberCan } from '@dotrino/identity/acta'

const SERVICE = '{"kty":"EC","x":"bot"}'
const DEVICE = '{"kty":"EC","x":"telefono"}'
const EVICTED = '{"kty":"EC","x":"echado"}'
const NO_SIGN = '{"kty":"EC","x":"solo-lee"}'

const acta = {
  seq: 12,
  members: [
    { pub: SERVICE, cn: 'eco', caps: ['secrets', 'sign'] },
    { pub: DEVICE, cn: null, caps: ['sign', 'read', 'store'] },
    { pub: NO_SIGN, cn: 'mirador', caps: ['secrets'] }
  ]
}

/** El guardián, tal cual está en `handleHandshake`. */
const canHandshake = (device) =>
  (acta.members || []).some((m) => m?.pub === device) && memberCan(acta, device, 'sign')

test('un SERVICE puede saludar: está probando que es él, no que habla por ti', () => {
  assert.equal(canHandshake(SERVICE), true)
})

test('un aparato tuyo también, como siempre', () => {
  assert.equal(canHandshake(DEVICE), true)
})

test('a quien el acta ya no nombra se le sigue cerrando la puerta', () => {
  assert.equal(canHandshake(EVICTED), false)
})

test('y a un miembro sin `sign` también: se afloja lo que sobraba, no lo que protegía', () => {
  assert.equal(canHandshake(NO_SIGN), false)
})
