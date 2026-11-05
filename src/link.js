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
import { signWithDevice, pubkeyId, makeDeviceKey, makeDeviceEncKey } from '@dotrino/identity/capabilities'
import { requestDevices, requestRenew } from '@dotrino/identity/vault/remote.js'
import { installNodeGlobals } from '../node-globals.js'
import { adoptRecord } from './record.js'
import { verifySealerChain, genesisActa, sealActa } from '@dotrino/identity/acta'
import { DEFAULT_PROXY, RENEW_BEFORE_MS } from '../protocol.js'
// Estático y no perezoso: `loadLink`/`saveLink` son síncronos y así siguen. Necesita
// @dotrino/vault >= 0.115.0 (la primera que exporta `atrest`).
import { atRestFor, isEncrypted } from '@dotrino/vault/atrest'
/** @typedef {import('./shapes.js').AgentIdentity} AgentIdentity */
/** @typedef {import('./shapes.js').DotrinoActa} DotrinoActa */

/**
 * El papel de un aparato: lo firma la bóveda. `seq` es el del acta con que se emitió; `exp`
 * solo lo lleva el modelo viejo (por fecha).
 * @typedef {{ seq?: number, exp?: number } & Record<string, unknown>} AgentCert
 */

/**
 * El enlace de esta máquina con su cuenta (`link.json`). Con bóveda: `device`, `enc`, `cert`,
 * `iss`, `proxy`. Propio (`self: true`): `device`, `enc` y su génesis en `sealerChain`.
 * @typedef {object} AgentLink
 * @property {{ publickey: string, privateJwk: JsonWebKey }} device
 * @property {{ publickey?: string, privateJwk?: JsonWebKey } & Record<string, unknown>} [enc]
 * @property {AgentCert} [cert]
 * @property {string} [iss]          la bóveda con que se enroló
 * @property {string} [proxy]
 * @property {string} [label]
 * @property {string} [ns]
 * @property {number} [at]
 * @property {boolean} [self]
 * @property {DotrinoActa[]} [sealerChain]
 * @property {DotrinoActa} [acta]     el acta de confianza (solo si `actaTrusted`)
 * @property {boolean} [actaTrusted]
 * @property {number} [actaSeq]      la `seq` del acta más nueva que se ha visto
 * @property {string[]} [blocked]   aparatos bloqueados por la bóveda (pubkeys)
 */

/** @param {string} [name] @returns {string} */
export function dataDir (name = 'dotrino-remote-agent') {
  if (process.env.DOTRINO_REMOTE_AGENT_DIR) return process.env.DOTRINO_REMOTE_AGENT_DIR
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share')
  return path.join(base, name)
}

const linkPath = (/** @type {string} */ dir) => path.join(dir, 'link.json')

/*
 * EL ENLACE VA CIFRADO EN REPOSO (0.30.0). Lleva la llave privada del aparato, y hasta aquí
 * estaba en claro (0600): copiar el archivo bastaba para hacerse pasar por el aparato. Se cifra
 * con `@dotrino/vault/atrest`, el mismo cifrado de la bóveda y de la identidad de un servicio:
 * una clave sacada de esta máquina (`/etc/machine-id` + un salt de la carpeta), así que el
 * archivo copiado a otro equipo no sirve. No protege contra quien ya entra a esta máquina
 * como tu usuario; eso pediría un TPM o el llavero del sistema.
 */

/**
 * Lee el enlace persistido, o `null` si NO EXISTE. Un enlace en claro (anterior a 0.30.0) se
 * lee y se reescribe cifrado en el acto, comprobando antes que se vuelve a leer igual.
 *
 * Si existe y no se puede leer —otro equipo, la máquina cambió, el archivo está roto— LANZA
 * (`link-unreadable`). Devolver `null` diría «no hay enlace», y quien lo llama crearía otro
 * encima del que ya era el aparato: la identidad se perdería en silencio.
 */
export function loadLink (dir = dataDir()) {
  let text
  try { text = fs.readFileSync(linkPath(dir), 'utf8') } catch (err) {
    const e = /** @type {NodeJS.ErrnoException} */ (err)
    if (e?.code === 'ENOENT') return null
    throw Object.assign(new Error(`cannot read the link (${linkPath(dir)}): ${e.message}`), { code: 'link-unreadable' })
  }
  const box = atRestFor(dir)
  /** @type {AgentLink} */
  let link
  try { link = JSON.parse(box.decrypt(text)) } catch (e) {
    throw Object.assign(new Error(`cannot open the link (${linkPath(dir)}): it was encrypted on another machine, or the file is damaged. Enroll this device again.`), { code: 'link-unreadable', cause: e })
  }
  if (!isEncrypted(text)) writeEncrypted(dir, box, link)
  return link
}

/**
 * @param {string} dir
 * @param {ReturnType<typeof atRestFor>} box
 * @param {AgentLink} link
 */
function writeEncrypted (dir, box, link) {
  const json = JSON.stringify(link, null, 2)
  const blob = box.encrypt(json)
  if (box.decrypt(blob) !== json) throw Object.assign(new Error('link: at-rest verification failed, nothing was written'), { code: 'link-unwritable' })
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = linkPath(dir) + '.tmp'
  fs.writeFileSync(tmp, blob, { mode: 0o600 })
  fs.renameSync(tmp, linkPath(dir))
}

/** Persiste el enlace, cifrado (0600). Exportada porque la RENOVACIÓN del cert lo reescribe. */
/** @param {string} dir @param {AgentLink} link */
export function saveLink (dir, link) {
  writeEncrypted(dir, atRestFor(dir), link)
}

/**
 * Parsea una invitación de la bóveda a objeto. Acepta TODAS las formas que imprime
 * `dotrino-vault pair` (URL del QR, código compacto, JSON, base64url): es el mismo
 * `parseInvite` del ecosistema. `enroll` ya lo hace solo; esto es para quien quiera
 * mirar la invitación antes (qué bóveda, qué proxy) sin enrolar.
 * @param {string} text
 */
export async function parseQr (text) {
  const { parseInvite } = await import('@dotrino/vault/invite')
  const qr = parseInvite(String(text ?? '').trim())
  if (!qr?.sn || !(qr.iss || qr.conn)) throw new Error('invalid invitation: paste the output of `dotrino-vault pair`')
  return qr
}

/** base64url → utf8 (lo usan los tests y algún QR viejo). */
/** @param {string} s @returns {string} */
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
 * @param {string | null} [args.ns]             cajón de secretos que lee este agente (si lo hay).
 * @param {(c:{deviceId:string,code:string})=>void} [args.onChallenge]  mostrar el CÓDIGO para
 *        que un humano lo TIPEE en la bóveda al aprobar (el código NO viaja de aquí).
 * @param {number} [args.timeoutMs=180000]
 * @returns {Promise<AgentLink>}
 */
export async function enroll ({ qr, label = 'remote-agent', dir = dataDir(), ns = null, onChallenge, timeoutMs = 180000 } = /** @type {{ qr: string }} */ ({ qr: '' })) {
  installNodeGlobals(dir)
  const { enrollWithVault } = await import('@dotrino/vault/service')
  const res = await enrollWithVault({
    qr,
    label,
    expectedScope: ns ? 'vault:secrets:' + ns : null,
    onCode: onChallenge,
    approveTimeoutMs: timeoutMs
  })
  /** @type {AgentLink} */
  const link = { device: res.device, enc: res.enc, cert: res.cert, iss: res.iss, proxy: res.proxy, label, ...(ns ? { ns } : {}), at: Date.now() }
  saveLink(dir, link)
  return link
}

/**
 * UNA IDENTIDAD PROPIA, SIN BÓVEDA. El aparato cumple el rol cuando no hay pieza dedicada:
 * crea sus llaves (firma y cifrado) y un acta de génesis autofirmada donde él es el único
 * miembro. Es una cuenta de un solo aparato, igual que «este dispositivo es bóveda» en el
 * navegador: `verifySignedFor` la acepta sin saber nada más, porque la raíz de toda cuenta
 * es un acta autofirmada.
 *
 * El enlace queda `{ device, enc, label, self: true, sealerChain: [génesis], at }`, sin
 * `cert` ni `iss`.
 *
 * EMPAREJARLO DESPUÉS CAMBIA LA LLAVE, a propósito (dueño, 2026-11-04): `enroll` crea otra y
 * sobrescribe este enlace. Una llave está en UNA sola cuenta. Si entrara a una bóveda con la
 * misma, seguiría siendo la raíz de su génesis y podría entrar igual a otras bóvedas.
 *
 * @param {{ label?: string, dir?: string }} [args]
 * @returns {Promise<AgentLink>}
 */
export async function selfLink ({ label = 'remote-agent', dir = dataDir() } = {}) {
  installNodeGlobals(dir)
  const d = await makeDeviceKey({ label })
  const e = await makeDeviceEncKey()
  const genesis = await sealActa({
    acta: genesisActa({ pub: d.publickey, encPub: e.encPublickey, label }),
    privateJwk: d.privateJwk
  })
  /** @type {AgentLink} */
  const link = {
    device: { publickey: d.publickey, privateJwk: d.privateJwk },
    enc: { publickey: e.encPublickey, privateJwk: e.encPrivateJwk },
    label, self: true, sealerChain: [genesis], at: Date.now()
  }
  saveLink(dir, link)
  return link
}

/** ¿Es una identidad propia (sin bóveda)? */
export const isSelfLink = (/** @type {AgentLink | null | undefined} */ link) => link?.self === true

/**
 * La IDENTIDAD de un agente a partir de su enlace: lo que un cliente del ecosistema
 * espera como `link.id` (`RemoteAgentClient`, `ContentClient`, `listAgentsByLabel`) —
 * `me.publickey`, `signData`, `listVaultDevices`, `getVaultCert`, `vaultStatus`— pero
 * firmando con la llave del aparato en vez de con el pilar del navegador. Así un agente
 * Node puede ser CLIENTE de otro agente (un bot que guarda en el node de contenido)
 * con el mismo código que usa una app.
 *
 * @param {AgentLink} link  el enlace (`loadLink(dir)`).
 * @param {{ dir?: string }} [opts]  dir para los globals de Node (localStorage del proxy-client).
 * @returns {AgentIdentity}
 */
export function identityFromLink (link, { dir = dataDir() } = {}) {
  if (isSelfLink(link)) return selfIdentity(link, dir)
  if (!link?.device?.privateJwk || !link?.cert || !link?.iss) throw new Error('invalid link: device/cert/iss required')
  installNodeGlobals(dir)
  const device = link.device
  const proxy = link.proxy || DEFAULT_PROXY
  const iss = link.iss  // comprobado arriba
  return {
    me: { publickey: device.publickey },
    /** @param {object} data */
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
        paired: true, master: iss, proxy, deviceId: await pubkeyId(device.publickey),
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
      const res = await requestDevices({ master: iss, proxy, device, cert: link.cert })
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

/**
 * La identidad de un enlace propio: firma con su llave y prueba con su génesis. Lo que
 * pregunta a una bóveda no existe aquí, y se dice (`no-vault`) en vez de inventarse.
 */
/** @param {AgentLink} link @param {string} dir @returns {AgentIdentity} */
function selfIdentity (link, dir) {
  const chain = link.sealerChain
  if (!link?.device?.privateJwk || !Array.isArray(chain) || chain.length !== 1) throw new Error('invalid self link: device and its genesis required')
  installNodeGlobals(dir)
  const device = link.device
  const noVault = () => Promise.reject(Object.assign(new Error('this device has its own identity and is not paired with a vault'), { code: 'no-vault' }))
  return {
    me: { publickey: device.publickey },
    /** @param {object} data */
    async signData (data) {
      const signed = await signWithDevice({ privateJwk: device.privateJwk, publickey: device.publickey, data })
      return { ...signed, profileId: chain[0].profileId, chain }
    },
    getVaultCert: noVault,
    async vaultStatus () {
      return { paired: false, self: true, master: null, proxy: link.proxy || DEFAULT_PROXY, deviceId: await pubkeyId(device.publickey), seq: chain[0].seq }
    },
    listVaultDevices: noVault,
    async profileActa () { return { acta: chain[0] } }
  }
}

const trustedActaOf = (/** @type {AgentLink} */ link) => (link?.actaTrusted === true && link.acta ? link.acta : null)

/**
 * El acta que `listVaultDevices` puede dar por buena. Exportada para las pruebas.
 * @param {AgentLink} link
 * @param {DotrinoActa | null | undefined} candidate  la que llegó por la red
 * @param {string} me
 * @returns {Promise<DotrinoActa | null>}
 */
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
 * @param {AgentLink} link
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
/** @param {{ dir: string, link: AgentLink, cert: AgentCert, acta: DotrinoActa }} o */
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
 * @param {AgentLink} link   el enlace (se muta con el cert nuevo).
 * @param {{ dir?: string, force?: boolean }} [opts]
 * @returns {Promise<{ renewed: boolean, seq?: number | null, reason?: string }>}  `seq`: la del papel que queda
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
    const { cert, acta } = await requestRenew({ master: /** @type {string} */ (link.iss), proxy: link.proxy || DEFAULT_PROXY, device: link.device, cert: link.cert })
    // SE GUARDA ANTES DE DAR NADA POR BUENO. Emitir un papel RETIRA el anterior, así que si
    // esto no se persiste la máquina se queda usando uno revocado y fuera para siempre. Le
    // pasó al registro de selladores en la migración, y por eso está dicho aquí.
    await storeRenewedCert({ dir, link, cert, acta })
    return { renewed: true, seq: cert.seq }
  } catch (e) {
    return { renewed: false, seq: link.cert.seq ?? null, reason: /** @type {Error} */ (e).message }
  }
}

/**
 * TRAE LA CADENA DE SELLADORES de la cuenta y la guarda en el enlace: con ella `signData`
 * firma a nombre de la cuenta de forma que `verifySignedFor` lo compruebe desde el génesis.
 * Se comprueba ANTES de guardarla (`verifySealerChain`): una cadena que no encadena o que es
 * de otra cuenta no entra. Un agente que firma de cara a terceros la pide al arrancar y la
 * refresca de vez en cuando. No lanza: devuelve qué pasó.
 *
 * @param {AgentLink} link
 * @param {{ dir?: string }} [opts]
 * @returns {Promise<{ ok: boolean, seq?: number, reason?: string, self?: boolean }>}
 */
export async function refreshChain (link, { dir = dataDir() } = {}) {
  // Una identidad propia es su propia cadena: no hay a quién preguntar ni nada que caduque.
  if (isSelfLink(link)) return { ok: true, seq: link.sealerChain?.[0]?.seq ?? 1, self: true }
  if (!link?.device?.privateJwk || !link?.cert || !link?.iss) return { ok: false, reason: 'invalid link' }
  installNodeGlobals(dir)
  try {
    const res = await requestDevices({ master: link.iss, proxy: link.proxy || DEFAULT_PROXY, device: link.device, cert: link.cert })
    const chain = /** @type {DotrinoActa[] | undefined} */ (res.sealerChain)
    if (!Array.isArray(chain) || !chain.length) return { ok: false, reason: 'the vault sent no sealer chain (vaultd < 0.154.0?)' }
    const expected = link.sealerChain?.[0]?.profileId ?? link.acta?.profileId ?? null
    const v = await verifySealerChain(chain, { expectedProfileId: expected })
    if (!v.ok) return { ok: false, reason: 'bad sealer chain: ' + v.reason }
    const head = chain[chain.length - 1]
    const stored = link.sealerChain?.[link.sealerChain.length - 1]
    if (typeof stored?.seq === 'number' && head.seq < stored.seq) {
      return { ok: false, reason: 'older than the chain already stored' }
    }
    link.sealerChain = chain
    saveLink(dir, link)
    return { ok: true, seq: head.seq }
  } catch (err) {
    const e = /** @type {Error & { code?: string } | undefined} */ (err)
    // Un fallo de red llega a veces sin frase: se dice el código, o al menos que no se alcanzó.
    return { ok: false, reason: e?.message || e?.code || 'unreachable' }
  }
}

/**
 * El enlace como lo esperan `ContentClient.connect({ link })` y `RemoteAgentClient`.
 * @param {AgentLink} link
 * @param {{ dir?: string }} [opts]
 */
export function clientLink (link, opts) {
  return { id: identityFromLink(link, opts), cert: link.cert, iss: link.iss, proxy: link.proxy || DEFAULT_PROXY }
}

export default { dataDir, loadLink, saveLink, parseQr, enroll, selfLink, isSelfLink, identityFromLink, clientLink, renewLink, renewalReason, storeRenewedCert, refreshChain }
