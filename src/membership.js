/**
 * membership.js — ¿PUEDE ESTE APARATO ESTAR EN UNA SESIÓN? Una sola regla, para las dos puntas.
 *
 * Lo dice el ACTA vigente, y nada más: que la nombre y que le reconozca `sign`. El papel
 * (`cert`) no basta: no caduca, así que el de un aparato que el dueño ya quitó sigue bien
 * firmado. Por eso el papel prueba QUIÉN lo emitió y el acta decide si ese aparato sigue
 * dentro.
 *
 * Antes la comprobaba solo el agente. El cliente se fiaba del papel del agente, y abría
 * sesión con una máquina quitada del acta (robada, por ejemplo) o con cualquier llave con
 * papel de la cuenta que dijera ser esa máquina (2026-10-23).
 *
 * Sin acta no se sabe, y no saber es que no.
 */
import { memberCan, samePubkey } from '@dotrino/identity/acta'

/** @returns {boolean} */
export function canGreet (acta, pub) {
  if (!acta || typeof pub !== 'string' || !pub) return false
  return (acta.members || []).some((m) => samePubkey(m?.pub, pub)) && memberCan(acta, pub, 'sign')
}

export default { canGreet }
