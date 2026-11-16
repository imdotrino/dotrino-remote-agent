/**
 * update.js — un agente SE ACTUALIZA SOLO (CONVENCIONES §15, dueño 2026-10-08).
 *
 * Lo común de todos los agentes que se instalan por npm (`terminal-agent`,
 * `remote-desktop-agent`…): mirar, verificar e instalar lo hace `@dotrino/update/npm`; a quién
 * se pregunta y a quién se avisa, `@dotrino/vault/service`. Aquí se juntan las dos piezas con
 * lo que sí es común a los agentes: el enlace vive en una carpeta y se lee en cada llamada, y
 * el agente solo se reinicia cuando no está atendiendo a nadie.
 *
 * Lo propio de cada agente se le pasa: su paquete, su repo, cómo se llaman sus releases y
 * cuándo está ocupado (`busy`: la terminal cuenta consolas abiertas; el escritorio, gente
 * mirando).
 */
import { watchSelfUpdateNpm } from '@dotrino/update/npm'
import { vaultUpdateHooks } from '@dotrino/vault/service'
import { loadLink } from './link.js'

/** Cada cuánto se mira si ya está libre para reiniciar con la versión instalada. */
export const IDLE_CHECK_MS = 60_000

/** @type {(code: string, message: string) => Error & { code: string }} */
const fail = (code, message) => Object.assign(new Error(message), { code })

/**
 * Lo que un agente le dice a SU bóveda sobre actualizarse: los tres ganchos de
 * `vaultUpdateHooks`, armados EN CADA LLAMADA con el enlace leído del disco. El papel se renueva
 * mientras el agente corre, y el agente puede arrancar sin enlace y enlazarse después: una
 * conexión fijada al arrancar se quedaría vieja.
 *
 * @param {{ dir: string, product: string, log?: (m: string) => void, load?: (dir: string) => any, make?: typeof vaultUpdateHooks }} o
 * @returns {import('@dotrino/vault/service').UpdateHooks}
 */
export function vaultHooks ({ dir, product, log = console.log, load = loadLink, make = vaultUpdateHooks }) {
  const now = () => {
    const link = load(dir)
    if (!link?.device || !link.cert || !link.iss) return null
    return make({ product, log, proxyUrl: link.proxy || 'wss://proxy.dotrino.com', masterPubkey: link.iss, device: link.device, cert: link.cert })
  }
  return {
    // true = sí · false = no, o pasó el día sin respuesta · lanza = no se pudo preguntar.
    /** @param {import('@dotrino/vault/service').UpdateInfo} u */
    async mayUpdate (u) {
      const h = now()
      // Sin enlace no hay a quién preguntar. No es un «no»: se dice y se reintenta.
      if (!h) throw fail('not-linked', 'this agent is not linked to a vault, so there is nobody to ask')
      return h.mayUpdate(u)
    },
    // Sin enlace no hay bóveda a la que contárselo: no es un fallo que reintentar.
    /** @param {import('@dotrino/vault/service').UpdateInfo} u */
    async onUpdated (u) { await now()?.onUpdated(u) },
    /** @param {import('@dotrino/vault/service').UpdateInfo} u */
    async onNeedsRoot (u) { await now()?.onNeedsRoot(u) }
  }
}

/**
 * Enciende la autoactualización de un agente que ya corre.
 *
 * La versión nueva se instala en cuanto sale, pero el agente solo se va cuando `busy()` da 0:
 * tumbarle a alguien lo que está usando para estrenar una versión es justo lo contrario de lo
 * que se quiere. Y sin quien lo levante (systemd, pm2) no se va nunca: irse sería apagarle el
 * servicio al usuario.
 *
 * @param {{
 *   pkg: string, repo: string, tag: (version: string) => string, label: string,
 *   dir: string, version: string, busy: () => number, close: () => unknown,
 *   exit?: (code: number) => void, log?: (m: string) => void, watch?: typeof watchSelfUpdateNpm,
 *   hooks?: import('@dotrino/vault/service').UpdateHooks, idleCheckMs?: number
 * }} o
 *   `label`: con qué se presenta en el log (`terminal-agent`). `busy`: cuánto está atendiendo
 *   ahora (consolas, gente mirando). `close`: cerrar lo suyo antes de salir.
 * @returns {() => void} para dejar de mirar
 */
export function startSelfUpdate ({ pkg, repo, tag, label, dir, version, busy, close, exit = (code) => process.exit(code), log = console.log, watch = watchSelfUpdateNpm, hooks = vaultHooks({ dir, product: pkg, log }), idleCheckMs = IDLE_CHECK_MS }) {
  /** @type {ReturnType<typeof setInterval> | null} */
  let waiting = null
  /** @param {string} v */
  const restart = async (v) => {
    log(`[${label}] restarting to run ${v}`)
    try { await close() } catch (_) {}
    exit(0)
  }
  const stop = watch({
    pkg,
    current: version,
    repo,
    tag,
    dir,
    ...hooks,
    onInstalled: ({ version: v, restart: supervised }) => {
      if (!supervised) return
      if (!busy()) { restart(v); return }
      if (waiting) return
      log(`[${label}] ${v} is installed · busy (${busy()}), so it restarts when it is free`)
      const timer = waiting = setInterval(() => { if (!busy()) { clearInterval(timer); waiting = null; restart(v) } }, idleCheckMs)
      timer.unref?.()
    },
    log
  })
  return () => { if (waiting) { clearInterval(waiting); waiting = null } stop?.() }
}

export default { startSelfUpdate, vaultHooks, IDLE_CHECK_MS }
