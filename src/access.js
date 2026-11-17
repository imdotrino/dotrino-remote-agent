/**
 * access.js — la CLAVE de esta máquina (un PIN o una contraseña), opcional.
 *
 * Venía de `dotrino-terminal/agent/access.js` y ahora es común (dueño, 2026-11-16: el escritorio
 * remoto también la lleva). Sin clave puesta no cambia nada: entra cualquier aparato de la cuenta
 * con los permisos del producto. Con clave, además hay que escribirla en cada conexión remota.
 * Lo que corre en ESTA máquina (las ventanas de Terminal por su socket local) no la pide: es del
 * mismo usuario que ya puede leer este archivo.
 *
 * Por el cable: la sesión que todavía no la escribió recibe `{ type: 'fail', code: 'locked' }`
 * a cualquier cosa que pida; manda `{ type: 'unlock', code }` y recibe `{ type: 'unlocked' }`, o
 * `fail` con `bad-code` / `wait` (`retryMs`). Ver `makeLock`.
 *
 * En el disco queda la sal y el resumen (scrypt), nunca la clave. La clave viaja dentro de la
 * sesión cifrada entre el aparato y el agente, así que el proxio no la ve.
 *
 * Los fallos se frenan POR AGENTE y no por sesión: quien prueba claves puede abrir otra
 * conexión, y eso no le da intentos nuevos. A los TRES seguidos (dueño, 2026-10-07) empieza
 * la espera, que se dobla con cada fallo más: es un bloqueo LOCAL de este servicio, nada más.
 *
 * Y a los tres fallos seguidos de UN MISMO aparato se avisa (`onIncident`): la bóveda se lo
 * pone en la mesa a quien aprueba, que bloquea o ignora desde el teléfono. Avisar no decide
 * nada aquí; el freno de arriba sigue igual.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const ACCESS_FILE = 'access.json'
export const MIN_LENGTH = 4
/** Fallos seguidos que se dejan pasar sin esperar: al tercero empieza la espera. */
export const FREE_TRIES = 3
/** Fallos seguidos de un mismo aparato que disparan el aviso a la bóveda. */
export const INCIDENT_AFTER = 3
const BASE_WAIT_MS = 30_000
const MAX_WAIT_MS = 60 * 60_000
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

/** @typedef {Error & { code?: string, retryMs?: number }} Thrown */

/** @type {(code: string, message: string, extra?: object) => Error & { code: string }} */
const fail = (code, message, extra = {}) => Object.assign(new Error(message), { code, ...extra })
/** @param {string} dir */
const file = (dir) => path.join(dir, ACCESS_FILE)
/** @type {(secret: unknown, salt: Buffer, params: import('node:crypto').ScryptOptions) => Buffer} */
const digest = (secret, salt, params) => crypto.scryptSync(String(secret).normalize('NFKC'), salt, 32, params)

/** Si esta máquina tiene clave. Un archivo que existe y no se puede leer NO es «sin clave»: se lanza. */
/** @param {string} dir */
export function hasAccessCode (dir) {
  return readRecord(dir) !== null
}

/**
 * @param {string} dir
 * @returns {{ v: 1, salt: string, hash: string, params: import('node:crypto').ScryptOptions } | null}
 */
function readRecord (dir) {
  let raw
  try { raw = fs.readFileSync(file(dir), 'utf8') } catch (e) {
    if (/** @type {Thrown} */ (e).code === 'ENOENT') return null
    throw fail('access-unreadable', `cannot read ${ACCESS_FILE}: ${/** @type {Thrown} */ (e).message}`)
  }
  let r
  try { r = JSON.parse(raw) } catch (_) { throw fail('access-unreadable', `${ACCESS_FILE} is not valid JSON`) }
  if (r?.v !== 1 || typeof r.salt !== 'string' || typeof r.hash !== 'string' || !r.params) {
    throw fail('access-unreadable', `${ACCESS_FILE} has an unknown shape`)
  }
  return r
}

/**
 * Pone o cambia la clave.
 * @param {string} dir
 * @param {unknown} secret
 */
export function setAccessCode (dir, secret) {
  if (typeof secret !== 'string' || secret.length < MIN_LENGTH) throw fail('too-short', `the code needs at least ${MIN_LENGTH} characters`)
  const salt = crypto.randomBytes(16)
  const record = { v: 1, salt: salt.toString('base64'), hash: digest(secret, salt, SCRYPT).toString('base64'), params: SCRYPT }
  const tmp = file(dir) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(record), { mode: 0o600 })
  fs.renameSync(tmp, file(dir))
}

/**
 * Quita la clave.
 * @param {string} dir
 */
export function clearAccessCode (dir) {
  fs.rmSync(file(dir), { force: true })
}

/**
 * Si `secret` es la clave de esta máquina. Sin frenos: para la orden local que la cambia.
 * @param {string} dir
 * @param {unknown} secret
 */
export function checkAccessCode (dir, secret) {
  const r = readRecord(dir)
  if (!r) throw fail('no-access-code', 'this machine has no code')
  const want = Buffer.from(r.hash, 'base64')
  const got = digest(secret ?? '', Buffer.from(r.salt, 'base64'), r.params)
  return want.length === got.length && crypto.timingSafeEqual(want, got)
}

/**
 * La puerta de un agente: comprueba la clave y frena los fallos seguidos. Una por agente,
 * compartida por todas sus sesiones.
 * @param {string} dir
 * @param {{ now?: () => number, onIncident?: ((i: { device: string, tries: number }) => void) | null }} [opts]
 *   `onIncident`: un mismo aparato (`device`, su pubkey) falló `INCIDENT_AFTER` veces seguidas.
 *   Se llama UNA vez por racha; la racha se corta al acertar.
 */
export function makeGate (dir, { now = Date.now, onIncident = null } = {}) {
  let fails = 0
  let until = 0
  /** Fallos seguidos por aparato: el aviso es sobre QUIÉN, y el freno sobre el agente. */
  const byDevice = new Map()
  return {
    /** Si hay que escribir la clave para entrar. Lanza `access-unreadable` si no se puede saber. */
    required: () => hasAccessCode(dir),
    /**
     * Lanza `wait` (con `retryMs`) o `bad-code`; si no lanza, la clave era la buena.
     * `device` es quién la escribió (pubkey), para contar sus fallos y avisar.
     */
    /**
     * @param {unknown} secret
     * @param {string | null} [device]
     */
    check (secret, device = null) {
      const left = until - now()
      if (left > 0) throw fail('wait', 'too many wrong codes', { retryMs: left })
      if (checkAccessCode(dir, secret)) { fails = 0; until = 0; if (device) byDevice.delete(device); return }
      fails++
      if (fails >= FREE_TRIES) until = now() + Math.min(BASE_WAIT_MS * 2 ** (fails - FREE_TRIES), MAX_WAIT_MS)
      if (device) {
        const n = (byDevice.get(device) || 0) + 1
        byDevice.set(device, n)
        if (n === INCIDENT_AFTER && onIncident) { try { onIncident({ device, tries: n }) } catch (_) {} }
      }
      throw fail('bad-code', 'wrong code', until ? { retryMs: until - now() } : {})
    }
  }
}

/**
 * El candado de UNA sesión: hasta que escribe la clave (si la máquina tiene), no pasa nada más.
 * Una vez escrita vale para esa conexión. Sin `gate` (lo local), siempre pasa.
 *
 *   session.on('message', (msg) => {
 *     if (lock.handle(msg)) return        // era el `unlock`: ya contestó
 *     if (!lock.mayPass()) return         // ya contestó `locked` (o que no se puede saber)
 *     …
 *   })
 *
 * No saber si hay clave (el archivo no se puede leer) es no pasar, y se dice.
 * @param {{ gate: ReturnType<typeof makeGate> | null, device?: string | null,
 *   send: (msg: object) => unknown }} o
 */
export function makeLock ({ gate, device = null, send }) {
  let unlocked = false
  /** @type {(code: string, message: string, extra?: object) => unknown} */
  const failMsg = (code, message, extra = {}) => send({ type: 'fail', code, message, ...extra })
  /** @param {unknown} e */
  const failWith = (e) => {
    const t = /** @type {Thrown} */ (e)
    failMsg(t.code || 'access-unreadable', t.message, t.retryMs ? { retryMs: t.retryMs } : {})
  }
  return {
    get unlocked () { return unlocked || !gate },
    /** True si esta sesión puede seguir; si no, ya contestó por qué. */
    mayPass () {
      if (!gate || unlocked) return true
      try {
        if (!gate.required()) return true
      } catch (e) { failWith(e); return false }
      failMsg('locked', 'this machine asks for its code')
      return false
    },
    /** Si `msg` es el `unlock`, lo atiende y devuelve true. @param {any} msg */
    handle (msg) {
      if (!msg || msg.type !== 'unlock') return false
      if (!gate) { send({ type: 'unlocked' }); return true }
      try {
        if (gate.required()) gate.check(msg.code, device)
        unlocked = true
        send({ type: 'unlocked' })
      } catch (e) { failWith(e) }
      return true
    }
  }
}

/**
 * Pregunta algo que no debe verse al teclearlo. Solo en una TTY: una clave no se pasa por una
 * tubería (`no-tty`). Ctrl+C sale (130).
 * @param {string} q
 * @returns {Promise<string>}
 */
export function askHidden (q) {
  if (!process.stdin.isTTY) return Promise.reject(fail('no-tty', 'the code is typed: a terminal is needed'))
  process.stdout.write(q)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  return new Promise((resolve) => {
    let typed = ''
    const onData = (/** @type {Buffer} */ b) => {
      // Una tecla que no es texto (flechas, Fin, el teclado numérico SIN Bloq Num) llega como una
      // secuencia de escape: se descarta entera; si no, «[F» entraba en la clave sin verse.
      const typedText = b.toString('utf8').replace(/\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O.|.)?/g, '')
      for (const ch of typedText) {
        if (ch === '\r' || ch === '\n') {
          process.stdin.off('data', onData); process.stdin.setRawMode(false); process.stdin.pause()
          process.stdout.write('\n'); resolve(typed); return
        }
        if (ch === '\x03') { process.stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130) }
        if (ch === '\x7f' || ch === '\b') typed = typed.slice(0, -1)
        else if (ch >= ' ') typed += ch
      }
    }
    process.stdin.on('data', onData)
  })
}

/**
 * La orden `lock` de un agente: `lock` pone o cambia la clave (se teclea dos veces), `lock --off`
 * la quita, `lock --status` dice si hay. Se pone EN la máquina: quien está delante ya puede leer y
 * borrar el archivo, así que ni cambiarla ni quitarla piden la anterior. Vale al momento.
 * Devuelve el texto para el usuario; lanza con `code` (`too-short`, `mismatch`, `no-tty`).
 * @param {{ dir: string, args: string[], lang?: 'es' | 'en', what: { es: string, en: string }, localNote?: { es: string, en: string } | null }} o
 *   `what`: lo que hace quien entra («abrir consolas», «usar el escritorio»).
 *   `localNote`: si lo de esta misma máquina no la pide, la frase que lo dice.
 * @returns {Promise<string>}
 */
export async function lockCommand ({ dir, args, lang = 'es', what, localNote = null }) {
  const es = lang === 'es'
  const w = es ? what.es : what.en
  if (args.includes('--status')) {
    return hasAccessCode(dir)
      ? (es ? `Hay clave: tus otros aparatos la escriben para ${w} de esta máquina.` : `There is a code: your other devices type it to ${w} of this machine.`)
      : (es ? `Sin clave: cualquier aparato de tu cuenta con permiso puede ${w} de esta máquina.` : `No code: any device of your account with the permission can ${w} of this machine.`)
  }
  if (args.includes('--off')) {
    if (!hasAccessCode(dir)) return es ? 'Esta máquina no tenía clave.' : 'This machine had no code.'
    clearAccessCode(dir)
    return es ? 'Clave quitada.' : 'Code removed.'
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const changing = hasAccessCode(dir)
  const first = await askHidden(es ? `Clave nueva (PIN o contraseña, mínimo ${MIN_LENGTH}): ` : `New code (PIN or password, at least ${MIN_LENGTH}): `)
  if (first.length < MIN_LENGTH) throw fail('too-short', es ? `demasiado corta: mínimo ${MIN_LENGTH} caracteres` : `too short: at least ${MIN_LENGTH} characters`)
  const again = await askHidden(es ? 'Otra vez: ' : 'Again: ')
  if (again !== first) throw fail('mismatch', es ? 'no coinciden. No se cambió nada.' : 'they do not match. Nothing was changed.')
  setAccessCode(dir, first)
  if (changing) return es ? 'Clave cambiada. Los aparatos que ya estaban dentro siguen hasta que se desconecten.' : 'Code changed. Devices already in stay until they disconnect.'
  const note = localNote ? ' ' + (es ? localNote.es : localNote.en) : ''
  return (es ? `Clave puesta. Tus otros aparatos la escriben para ${w} de esta máquina.` : `Code set. Your other devices type it to ${w} of this machine.`) + note
}
