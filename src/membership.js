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
/** @typedef {import('./shapes.js').DotrinoActa} DotrinoActa */

/**
 * @param {DotrinoActa | null | undefined} acta
 * @param {unknown} pub
 * @returns {boolean}
 */
export function canGreet (acta, pub) {
  if (!acta || typeof pub !== 'string' || !pub) return false
  return (acta.members || []).some((m) => samePubkey(m?.pub, pub)) && memberCan(acta, pub, 'sign')
}

/**
 * Los permisos de PRODUCTO que le faltan a ese aparato (`terminal`, `desktop`…): los que el
 * agente declara en `needs`, además de `sign` (dueño, 2026-11-16, tras la auditoría: con solo
 * `sign`, cualquier aparato del acta —un bot, un navegador prestado— abría una consola o el
 * escritorio en todas las máquinas). Sin acta faltan todos: no hay con qué decir que sí.
 * @param {DotrinoActa | null | undefined} acta
 * @param {unknown} pub
 * @param {readonly string[]} needs
 * @returns {string[]}
 */
export function missingCaps (acta, pub, needs) {
  if (!acta || typeof pub !== 'string' || !pub) return [...needs]
  return needs.filter((c) => !memberCan(acta, pub, c))
}

export default { canGreet, missingCaps }
