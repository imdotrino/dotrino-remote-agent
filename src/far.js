/**
 * far.js — el agente de ESTA máquina como CLIENTE de los agentes de las otras máquinas de la
 * cuenta, para las ventanas locales (las que le hablan por `local.js`).
 *
 * Entra con su propio enlace (`clientLink`): es un aparato del acta y entra como cualquier otro,
 * con lo que el acta le reconozca. Lo que aquí hay es lo común a todo agente con ventanas
 * locales: QUÉ máquinas hay de un tipo y ABRIR una sesión con una. Lo que se habla después es
 * del producto (las consolas de Terminal, la escena del escritorio remoto).
 *
 * Venía de `dotrino-terminal/agent/far.js` (`discoverReal`, `connectReal` y el registro de
 * fallos, 2026-11-17): el escritorio remoto necesitaba lo mismo.
 */
import { RemoteAgentClient } from './client.js'
import { clientLink } from './link.js'
import { listAgentsByLabel, probeAgents } from './discover.js'
import { keyLabel } from '@dotrino/identity/capabilities'

/**
 * Cada cuánto se le pide el acta a la BÓVEDA. Entre medias vale la guardada, que el agente ya
 * refresca solo. Pedirla en cada vuelta no dejaba dormirse a la bóveda de Lambda (2026-10-25).
 */
export const MEMBERS_MS = 5 * 60_000

/** @typedef {import('./link.js').AgentLink} AgentLink */
/** Una máquina de la cuenta con un agente del tipo buscado encendido. */
/** @typedef {{ sub: string, id: string, name: string }} FoundAgent */
/**
 * Lo que se guarda entre una búsqueda y la siguiente: la conexión con la que se pregunta quién
 * contesta, y cuándo se le pidió el acta a la bóveda por última vez.
 * @typedef {{ probe: import('@dotrino/proxy-client').WebSocketProxyClient | null, askedVaultAt?: number }} DiscoverState
 */

/**
 * Las máquinas de la cuenta con un agente de tipo `kind` encendido (las que contestan al ping
 * diciendo que son de ese tipo).
 * @param {{ link: AgentLink, dir: string, kind: string, state: DiscoverState, membersMs?: number }} o
 * @returns {Promise<FoundAgent[]>}
 */
export async function discoverAgents ({ link, dir, kind, state, membersMs = MEMBERS_MS }) {
  const cl = clientLink(link, { dir })
  const fresh = !state.askedVaultAt || Date.now() - state.askedVaultAt >= membersMs
  const members = await listAgentsByLabel(/** @type {any} */ (cl.id), undefined, { fresh })
  if (fresh) state.askedVaultAt = Date.now()
  if (!members.length) return []
  if (!state.probe) {
    const { WebSocketProxyClient } = await import('@dotrino/proxy-client')
    state.probe = new WebSocketProxyClient({ url: cl.proxy, enableWebRTC: false, autoReconnect: true })
    await state.probe.connect()
  }
  const found = await probeAgents(/** @type {any} */ (state.probe), members.map((m) => m.sub))
  /** @type {FoundAgent[]} */
  const out = []
  for (const m of members) {
    if (found.get(m.sub)?.kind !== kind) continue
    out.push({ sub: m.sub, id: await keyLabel(m.sub), name: m.label || '' })
  }
  return out
}

/**
 * Una sesión con el agente de otra máquina.
 *
 * EL ACTA DE CONFIANZA DE ESTE AGENTE se lee del disco en cada saludo: la mantiene al día su
 * lado de agente. Sin ella el cliente le pedía el acta a la bóveda en cada conexión, y la
 * ventana esperaba 4-17 s (2026-11-04). Si con ella no pasa, el cliente sí pregunta a la bóveda.
 *
 * @param {{ link: AgentLink, dir: string, sub: string, loadLink?: () => AgentLink | null }} o
 * @returns {Promise<RemoteAgentClient>}
 */
export async function connectAgent ({ link, dir, sub, loadLink }) {
  const trustedActa = () => {
    const l = /** @type {any} */ (loadLink?.() || link)
    return l?.actaTrusted === true && l.acta ? /** @type {any} */ (l.acta) : null
  }
  const rc = new RemoteAgentClient(/** @type {any} */ (clientLink(link, { dir })), { agentPubkey: sub, trustedActa })
  await rc.connect()
  return rc
}

/**
 * LO QUE FALLA QUEDA ESCRITO, CON SU HORA, y solo al CAMBIAR (falla, cambia de motivo o se
 * recupera): el refresco va cada pocos segundos y una línea por vuelta ahogaría el log.
 * @param {(line: string) => void} log
 * @returns {(what: string, failure: unknown, ms?: number) => void}
 */
export function failureLog (log) {
  /** @type {Map<string, string>} */
  const last = new Map()
  return (what, failure, ms) => {
    const err = /** @type {{ code?: string, message?: string } | null} */ (failure)
    const code = err ? (err.code || 'error') : null
    if ((last.get(what) ?? null) === code) return
    const took = typeof ms === 'number' ? ` after ${ms} ms` : ''
    if (code) log(`[far] ${new Date().toISOString()} ${what}: ${code}${took} · ${err?.message || ''}`)
    else log(`[far] ${new Date().toISOString()} ${what}: ok again${took}`)
    if (code) last.set(what, code); else last.delete(what)
  }
}

export default { discoverAgents, connectAgent, failureLog, MEMBERS_MS }
