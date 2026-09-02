/**
 * discover.js — autodescubrimiento de agentes de la cuenta, POR EL ACTA.
 *
 * Quién pertenece a esta cuenta lo dice el ACTA, y solo el acta. Aquí se pregunta ahí, que
 * es además lo único que un servicio tiene derecho a ver.
 *
 * **Antes se preguntaba al inventario de certificados** (`vault.devices`), y eso se rompió
 * el 2026-08-31 por una razón correcta: un servicio pasó a recibir sus revocaciones y el
 * acta, pero **no el inventario de aparatos del dueño** — no es asunto suyo (vaultd 0.75.1).
 * Desde entonces cualquier servicio que buscara un agente recibía una lista vacía y
 * concluía «no tienes ninguno». El bot social estuvo veinte horas así, reintentando cada
 * minuto contra un node de contenido que estaba encendido y a su lado.
 *
 * La distinción es la que importa y no es un detalle de implementación:
 *
 *   · el **acta** dice QUIÉN ES DE LA CUENTA — la tiene todo miembro, y para eso existe
 *   · el **inventario** dice qué papeles ha firmado el dueño y cuándo caducan — es suyo
 *
 * Para hablarle a otro agente hace falta lo primero. Se pide `listVaultDevices()` igual,
 * pero por su efecto útil: trae el acta vigente (o la cadena) y la adopta. Lo que se lee
 * después son sus miembros.
 */

/**
 * @param {object} id   instancia de Identity (del vault) ya conectada.
 * @param {string} [label]  filtrar por servicio/label exacto (p. ej. `'content'`,
 *   `'ia-agent'`). Omitir = todos los que tengan nombre y no sean `'cli'` (un navegador
 *   enrolado queda como `cli` y no atiende a nadie).
 * @returns {Promise<Array<{sub:string,label:string,cn:string|null}>>} uno por miembro.
 */
export async function listAgentsByLabel (id, label) {
  // Por su efecto: trae el acta vigente y la adopta. La lista de aparatos que devuelva —si
  // devuelve alguna— no se mira: quién es de la cuenta lo dice el acta.
  let acta = null
  try { acta = (await id.listVaultDevices())?.acta || null } catch (_) {}
  if (!acta) acta = (await id.profileActa?.().catch(() => null))?.acta || null
  if (!acta) return []

  const mine = id.me?.publickey
  const nombre = (m) => m.cn || m.label || null
  return (acta.members || [])
    .filter((m) => m?.pub && m.pub !== mine)
    .filter((m) => (label ? nombre(m) === label : (nombre(m) && nombre(m) !== 'cli')))
    .map((m) => ({ sub: m.pub, label: m.label || m.cn || '', cn: m.cn || null }))
}

export default { listAgentsByLabel }
