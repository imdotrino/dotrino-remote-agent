/**
 * link.js — enrola ESTA máquina como un dispositivo del vault (mismo flujo
 * endurecido que usa el navegador / `dotrino-vault/src/client.js#enroll`). Es lo
 * que vuelve al agente INDEPENDIENTE de la máquina del vault: guarda su propia
 * sub-clave `D` + `cert` (cadena `D ← maestra`); la maestra NUNCA vive aquí, solo
 * su pública pineada (`iss`).
 *
 * Persistencia en un directorio propio (por defecto
 * `~/.local/share/<name>`, override `DOTRINO_REMOTE_AGENT_DIR` o `dir` explícito):
 * NO comparte carpeta con el vault, así el agente puede correr en otro host.
 *
 * El `label` (p. ej. `terminal-agent`, `ia-agent`) viaja en el cert y lo usa el
 * cliente para FILTRAR qué dispositivos son agentes del tipo que busca
 * (listAgentsByLabel).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { signWithDevice, pubkeyId } from '@dotrino/identity/capabilities'
import { requestDevices, requestRenew } from '@dotrino/identity/vault/remote.js'
import { installNodeGlobals } from '../node-globals.js'
import { adoptRecord } from './record.js'
import { verifySealerChain } from '@dotrino/identity/acta'
import { DEFAULT_PROXY, RENEW_BEFORE_MS } from '../protocol.js'

export function dataDir (name = 'dotrino-remote-agent') {
  if (process.env.DOTRINO_REMOTE_AGENT_DIR) return process.env.DOTRINO_REMOTE_AGENT_DIR
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(base, name)
}

const linkPath = (dir) => path.join(dir, 'link.json')

/** Lee el enlace persistido (o null si no está enrolado). */
export function loadLink (dir = dataDir()) {
  try { return JSON.parse(fs.readFileSync(linkPath(dir), 'utf8')) } catch { return null }
}

/** Persiste el enlace (0600). Exportada porque la RENOVACIÓN del cert lo reescribe. */
export function saveLink (dir, link) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(linkPath(dir), JSON.stringify(link, null, 2), { mode: 0o600 })
}

/**
 * Parsea una invitación de la bóveda a objeto. Acepta TODAS las formas que imprime
 * `dotrino-vault pair` (URL del QR, código compacto, JSON, base64url): es el mismo
 * `parseInvite` del ecosistema. `enroll` ya lo hace solo; esto es para quien quiera
 * mirar la invitación antes (qué bóveda, qué proxy) sin enrolar.
 */
export async function parseQr (text) {
  const { parseInvite } = await import('@dotrino/vault/invite')
  const qr = parseInvite(String(text ?? '').trim())
  if (!qr?.sn || !(qr.iss || qr.conn)) throw new Error('invalid invitation: paste the output of `dotrino-vault pair`')
  return qr
}

/** base64url → utf8 (lo usan los tests y algún QR viejo). */
export function b64urlDecode (s) {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64').toString('utf8')
}

/**
 * Enrola ESTA máquina contra la bóveda y persiste el enlace
 * `{ device, enc, cert, iss, proxy, label, ns?, at }`.
 *
 * El enrolamiento en sí es el del ecosistema —`enrollWithVault` de `@dotrino/vault`—
 * y no se duplica aquí: entiende cualquier invitación, crea las DOS llaves del aparato
 * (firma y **cifrado**: sin la segunda la bóveda no puede sellarle secretos) y
 * verifica el cert. Este módulo solo decide dónde vive.
 *
 * Lo que puede hacer el aparato lo decide la invitación (`dotrino-vault pair --scope …`):
 * no hay tipos de agente, hay permisos. Un bot que publica y lee su cajón se empareja
 * con `pair --service <ns> --scope sign`; pásale `ns` para que el enlace lo recuerde y
 * exija ese permiso en el cert.
 *
 * @param {object} args
 * @param {object|string} args.qr     La invitación, en cualquiera de sus formas.
 * @param {string} [args.label='remote-agent']  label del dispositivo (lo filtra el cliente).
 * @param {string} [args.dir=dataDir()]         dónde persistir el enlace.
 * @param {string} [args.ns]                    cajón de secretos que lee este agente (si lo hay).
 * @param {(c:{deviceId:string,code:string})=>void} [args.onChallenge]  mostrar el CÓDIGO para
 *        que un humano lo TIPEE en la bóveda al aprobar (el código NO viaja de aquí).
 * @param {number} [args.timeoutMs=180000]
 */
export async function enroll ({ qr, label = 'remote-agent', dir = dataDir(), ns = null, onChallenge, timeoutMs = 180000 } = {}) {
  installNodeGlobals(dir)
  const { enrollWithVault } = await import('@dotrino/vault/service')
  const res = await enrollWithVault({
    qr,
    label,
    expectedScope: ns ? 'vault:secrets:' + ns : null,
    onCode: onChallenge,
    approveTimeoutMs: timeoutMs
  })
  const link = { device: res.device, enc: res.enc, cert: res.cert, iss: res.iss, proxy: res.proxy, label, ...(ns ? { ns } : {}), at: Date.now() }
  saveLink(dir, link)
  return link
}

/**
 * La IDENTIDAD de un agente a partir de su enlace: lo que un cliente del ecosistema
 * espera como `link.id` (`RemoteAgentClient`, `ContentClient`, `listAgentsByLabel`) —
 * `me.publickey`, `signData`, `listVaultDevices`, `getVaultCert`, `vaultStatus`— pero
 * firmando con la llave del aparato en vez de con el pilar del navegador. Así un agente
 * Node puede ser CLIENTE de otro agente (un bot que guarda en el node de contenido)
 * con el mismo código que usa una app.
 *
 * @param {object} link  el enlace (`loadLink(dir)`).
 * @param {{ dir?: string }} [opts]  dir para los globals de Node (localStorage del proxy-client).
 */
export function identityFromLink (link, { dir = dataDir() } = {}) {
  if (!link?.device?.privateJwk || !link?.cert || !link?.iss) throw new Error('invalid link: device/cert/iss required')
  installNodeGlobals(dir)
  const device = link.device
  const proxy = link.proxy || DEFAULT_PROXY
  return {
    me: { publickey: device.publickey },
    async signData (data) {
      const signed = await signWithDevice({ privateJwk: device.privateJwk, publickey: device.publickey, data })
      // A NOMBRE DE QUIÉN VA, igual que en el navegador: el `profileId` y la cadena de
      // selladores que lo prueba (`refreshChain`). Sin cadena la firma vale ante la bóveda
      // (que conoce el papel) pero no ante un extraño que use `verifySignedFor`.
      const chain = Array.isArray(link.sealerChain) && link.sealerChain.length ? link.sealerChain : null
      return { ...signed, profileId: chain ? chain[0].profileId : null, chain }
    },
    async getVaultCert () { return { cert: link.cert } },
    async vaultStatus () {
      // `seq` es lo que describe un papel ahora; `exp` solo lo llevan los del modelo viejo
      // y se sigue dando mientras existan, para que quien mire sepa que le falta migrar.
      return {
        paired: true, master: link.iss, proxy, deviceId: await pubkeyId(device.publickey),
        seq: link.cert?.seq ?? null,
        ...(typeof link.cert?.exp === 'number' ? { exp: link.cert.exp, legacy: true } : {})
      }
    },
    async listVaultDevices () {
      // SIN `sinceSeq`: un agente no guarda el acta ni la encadena —no hay una sola línea
      // aquí que lea `chain`—, así que pedir el historial es traerse cientos de KB para
      // tirarlos. Y pedirlo con 0 era lo peor de todo: quien no tiene acta previa adopta la
      // actual de un salto («sin-acta-previa»), de modo que la cadena no iba a usarse jamás.
      // Costó tenerlo así: la respuesta llegó a 1,03 MB, el proxio corta el frame a 1 MB y
      // la bóveda se quedaba muda para todo el ecosistema (2026-08-24).
      const res = await requestDevices({ master: link.iss, proxy, device, cert: link.cert })
      // EL ACTA QUE SE DEVUELVE ES UNA COMPROBADA, nunca la que llegó por la red: la respuesta
      // no trae remitente comprobable, y con ella se decide quién es de la cuenta (a quién
      // se le abre una consola). Vale la que encadena desde la de confianza del enlace (o la
      // sella la bóveda con la que se enroló, `adoptRecord`); si no, la de confianza que ya había.
      return { ...res, acta: await checkedActa(link, res.acta, device.publickey) }
    },
    /** El acta de confianza del enlace (la que guardó el agente al comprobarla), o `null`. */
    async profileActa () {
      const acta = trustedActaOf(link)
      return acta ? { acta } : null
    }
  }
}

const trustedActaOf = (link) => (link?.actaTrusted === true && link.acta ? link.acta : null)

/** El acta que `listVaultDevices` puede dar por buena. Exportada para las pruebas. */
export async function checkedActa (link, candidate, me) {
  if (candidate && typeof candidate.seq === 'number') {
    const r = await adoptRecord({ link, candidate, me })
    if (r.adopt) return candidate
  }
  return trustedActaOf(link)
}

// Se reexporta por compatibilidad del subpath '/link'; la definición vive en protocol.js.
export { RENEW_BEFORE_MS }

/**
 * POR QUÉ TOCA PEDIR PAPEL NUEVO, o `null` si no toca. Es la única regla de renovación:
 * la usan `renewLink` (agentes que corren una vez) y el tic de `startRemoteAgent`.
 *   · `'legacy'`: el papel es del MODELO VIEJO (lleva `exp` y no `seq`). Se cambia sí o sí:
 *     se acepta por el repliegue de migración, pero muere en su fecha y con él la máquina.
 *   · `'behind'`: el acta que hemos visto va por delante del papel (el dueño cambió permisos).
 * Nunca por calendario: el papel no vence.
 *
 * @param {object} link
 * @returns {'legacy'|'behind'|null}
 */
export function renewalReason (link) {
  if (typeof link?.cert?.seq !== 'number') return 'legacy'
  if (typeof link.actaSeq === 'number' && link.actaSeq > link.cert.seq) return 'behind'
  return null
}

/**
 * GUARDA un papel renovado (ya comprobado por quien lo pidió) y lo persiste. SE GUARDA ANTES
 * DE DAR NADA POR BUENO: emitir un papel RETIRA el anterior, así que si esto no se persiste la
 * máquina se queda usando uno revocado y fuera para siempre.
 *
 * El acta que viaja con el papel se adopta SOLO si se puede comprobar (`record.js`): es la que
 * decide quién abre sesión con este agente. El papel sí se guarda siempre.
 */
export async function storeRenewedCert ({ dir, link, cert, acta }) {
  link.cert = cert
  link.actaSeq = acta.seq
  if ((await adoptRecord({ link, candidate: acta, me: link.device.publickey })).adopt) {
    link.acta = acta
    link.actaTrusted = true
  }
  saveLink(dir, link)
}

/**
 * RENUEVA el cert del enlace si vence pronto y lo persiste. Es lo que hace el agente
 * de larga duración en cada tic (`startRemoteAgent`), sacado aquí para los agentes que
 * corren UNA vez (un bot por cron): sin esto su cert muere a los 30 días y hay que
 * re-emparejar una máquina que nunca dejó de ser tuya.
 *
 * El cert nuevo se VERIFICA antes de guardarlo (misma maestra, misma llave, más vida).
 * Un cert ya vencido no se renueva: ahí toca re-emparejar. No lanza: devuelve qué pasó.
 *
 * @param {object} link   el enlace (se muta con el cert nuevo).
 * @param {{ dir?: string, force?: boolean }} [opts]
 * @returns {Promise<{ renewed: boolean, exp: number|null, reason?: string }>}
 */
export async function renewLink (link, { dir = dataDir(), force = false } = {}) {
  if (!link?.cert) return { renewed: false, seq: null, reason: 'no cert' }
  // EL PAPEL DEL MODELO VIEJO SE CAMBIA SÍ O SÍ. Lleva `exp` y no `seq`; se acepta por el
  // repliegue de migración pero muere en su fecha, y con él la máquina. Los demás se
  // renuevan cuando el acta va por delante — nunca por calendario, que el papel no vence.
  const why = renewalReason(link)
  if (why === 'legacy' && typeof link.cert.exp === 'number' && link.cert.exp <= Date.now()) {
    return { renewed: false, reason: 'expired: enroll again' }
  }
  if (!force && !why) return { renewed: false, seq: link.cert.seq, reason: 'not due' }
  installNodeGlobals(dir)
  try {
    // `requestRenew` ya JUZGA lo que devuelve (`checkVaultReply` del pilar: acta bien
    // firmada, esta bóveda puede sellarla, el papel lo firmó ella y es para esta llave) y
    // lanza si no cuadra. Aquí se comparaba `acta.profileId` con `link.iss`, que solo vale
    // en una cuenta que nació en esa bóveda: con una segunda bóveda no renovaba nunca.
    const { cert, acta } = await requestRenew({ master: link.iss, proxy: link.proxy || DEFAULT_PROXY, device: link.device, cert: link.cert })
    // SE GUARDA ANTES DE DAR NADA POR BUENO. Emitir un papel RETIRA el anterior, así que si
    // esto no se persiste la máquina se queda usando uno revocado y fuera para siempre. Le
    // pasó al registro de selladores en la migración, y por eso está dicho aquí.
    await storeRenewedCert({ dir, link, cert, acta })
    return { renewed: true, seq: cert.seq }
  } catch (e) {
    return { renewed: false, seq: link.cert.seq ?? null, reason: e.message }
  }
}

/**
 * TRAE LA CADENA DE SELLADORES de la cuenta y la guarda en el enlace: con ella `signData`
 * firma a nombre de la cuenta de forma que `verifySignedFor` lo compruebe desde el génesis.
 * Se comprueba ANTES de guardarla (`verifySealerChain`): una cadena que no encadena o que es
 * de otra cuenta no entra. Un agente que firma de cara a terceros la pide al arrancar y la
 * refresca de vez en cuando. No lanza: devuelve qué pasó.
 *
 * @returns {Promise<{ ok: boolean, seq?: number, reason?: string }>}
 */
export async function refreshChain (link, { dir = dataDir() } = {}) {
  if (!link?.device?.privateJwk || !link?.cert || !link?.iss) return { ok: false, reason: 'invalid link' }
  installNodeGlobals(dir)
  try {
    const res = await requestDevices({ master: link.iss, proxy: link.proxy || DEFAULT_PROXY, device: link.device, cert: link.cert })
    const chain = res.sealerChain
    if (!Array.isArray(chain) || !chain.length) return { ok: false, reason: 'the vault sent no sealer chain (vaultd < 0.154.0?)' }
    const expected = link.sealerChain?.[0]?.profileId ?? link.acta?.profileId ?? null
    const v = await verifySealerChain(chain, { expectedProfileId: expected })
    if (!v.ok) return { ok: false, reason: 'bad sealer chain: ' + v.reason }
    const head = chain[chain.length - 1]
    if (typeof link.sealerChain?.[link.sealerChain.length - 1]?.seq === 'number' && head.seq < link.sealerChain[link.sealerChain.length - 1].seq) {
      return { ok: false, reason: 'older than the chain already stored' }
    }
    link.sealerChain = chain
    saveLink(dir, link)
    return { ok: true, seq: head.seq }
  } catch (e) {
    // Un fallo de red llega a veces sin frase: se dice el código, o al menos que no se alcanzó.
    return { ok: false, reason: e?.message || e?.code || 'unreachable' }
  }
}

/** El enlace como lo esperan `ContentClient.connect({ link })` y `RemoteAgentClient`. */
export function clientLink (link, opts) {
  return { id: identityFromLink(link, opts), cert: link.cert, iss: link.iss, proxy: link.proxy || DEFAULT_PROXY }
}

export default { dataDir, loadLink, saveLink, parseQr, enroll, identityFromLink, clientLink, renewLink, renewalReason, storeRenewedCert, refreshChain }
