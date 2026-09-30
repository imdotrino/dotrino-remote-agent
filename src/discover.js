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

import { PING, PONG } from '../protocol.js'

/**
 * @param {object} id   instancia de Identity (del vault) ya conectada.
 * @param {string} [label]  filtrar por servicio/label exacto (p. ej. `'content'`,
 *   `'ia-agent'`). Omitir = todos los que tengan nameOf y no sean `'cli'` (un navegador
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
  const nameOf = (m) => m.cn || m.label || null
  return (acta.members || [])
    .filter((m) => m?.pub && m.pub !== mine)
    .filter((m) => (label ? nameOf(m) === label : (nameOf(m) && nameOf(m) !== 'cli')))
    .map((m) => ({ sub: m.pub, label: m.label || m.cn || '', cn: m.cn || null }))
}

/**
 * QUÉ AGENTE ES CADA UNO, preguntándoselo. Manda un `ra.ping` a cada pubkey por el
 * transporte que se le pase y devuelve los que contestan, con el `kind` que declara el
 * agente al arrancar (`startRemoteAgent({ label })`).
 *
 * Existe porque buscar por el label del ACTA no sirve: ese nombre lo pone el dueño al
 * emparejar («TerminalLocal», «el PC de la oficina»), así que una app que buscaba
 * `terminal-agent` no encontraba nada. Lo que un agente atiende lo sabe el agente.
 *
 * Un agente apagado no contesta y no sale: no se puede saber qué es sin preguntarle.
 *
 * @param {{ on:Function, sendByPubkey:Function }} client  un WebSocketProxyClient conectado.
 * @param {string[]} subs  pubkeys a preguntar (p. ej. las de `listAgentsByLabel(id)`).
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Map<string, { kind: string|null }>>} sub → lo que contestó.
 */
export function probeAgents (client, subs, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const found = new Map()
    if (!client || !subs?.length) return resolve(found)
    const bySub = new Map()
    const off = client.on('message', (_from, p) => {
      if (p?.type === PONG && bySub.has(p.n)) found.set(bySub.get(p.n), { kind: p.kind ?? null })
    })
    for (const sub of subs) {
      const n = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, '0')).join('')
      bySub.set(n, sub)
      // EFÍMERO: una pregunta de «¿estás ahí?» solo vale en vivo. Sin esto el proxio la
      // ENCOLABA para quien no estaba conectado y le tocaba el timbre: la app preguntaba a
      // todos los aparatos de la cuenta y el teléfono sonaba cada minuto sin ningún pedido
      // detrás (2026-09-30). Quien no contesta ahora, no está; eso es la respuesta.
      try { client.sendByPubkey(sub, { type: PING, n }, { ephemeral: true }) } catch (_) {}
    }
    setTimeout(() => { try { off() } catch (_) {} resolve(found) }, timeoutMs)
  })
}

export default { listAgentsByLabel, probeAgents }
