/**
 * record.js — ¿se puede dar por buena el acta que acaba de llegar?
 *
 * El acta decide quién abre sesión con el agente, así que no se guarda ninguna que no se
 * pueda comprobar. Hay dos casos y ninguno más:
 *
 *   · YA HAY una de confianza → la nueva tiene que encadenar desde ella (`canAdopt` del
 *     pilar: misma cuenta, bien firmada, sellada por quien la anterior nombra selladora, y
 *     nunca hacia atrás).
 *   · TODAVÍA NO (recién enrolado, o el acta la guardó una versión que no comprobaba nada)
 *     → solo vale una firmada por LA BÓVEDA CON LA QUE SE ENROLÓ (`link.iss`, la única llave
 *     que esta máquina tiene fijada), que nombre a esta máquina y no sea anterior a su papel.
 *     Si la última acta de la cuenta la selló otra selladora, no hay con qué comprobarla
 *     desde aquí: no se adopta, y toca enrolar de nuevo.
 *
 * Sin dependencias de Node: lo usa el agente y se prueba solo.
 */
import { canAdopt, verifyActa, samePubkey } from '@dotrino/identity/acta'

/**
 * @param {{ link: any, candidate: any, me: string }} args  `me` = la llave pública de esta máquina.
 * @returns {Promise<{ adopt: boolean, reason: string }>}
 */
export async function adoptRecord ({ link, candidate, me }) {
  if (!candidate || typeof candidate.seq !== 'number') return { adopt: false, reason: 'shape' }
  if (link?.actaTrusted === true && link.acta) return canAdopt({ candidate, current: link.acta })

  if (typeof link?.iss !== 'string') return { adopt: false, reason: 'no-pinned-vault' }
  const v = await verifyActa({ acta: candidate })
  if (!v.ok) return { adopt: false, reason: v.reason }
  if (!samePubkey(candidate.sealedBy, link.iss)) return { adopt: false, reason: 'not-sealed-by-pinned-vault' }
  if (!(candidate.members || []).some((m) => samePubkey(m?.pub, me))) return { adopt: false, reason: 'not-a-member' }
  if (typeof link.cert?.seq === 'number' && candidate.seq < link.cert.seq) return { adopt: false, reason: 'older-than-cert' }
  return { adopt: true, reason: 'sealed-by-pinned-vault' }
}

export default { adoptRecord }
