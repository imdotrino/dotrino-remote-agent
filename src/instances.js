/**
 * instances.js — dónde vive el enlace de cada agente de esta máquina. EL ESTÁNDAR del
 * ecosistema para todo agente de remote-agent (terminal, ia, los que vengan).
 *
 * Igual que `dotrino-env` (`~/.dotrino/service/<bóveda>/<cajón>`): cada agente tiene su
 * TIPO y su NOMBRE, y su propio enlace en `~/.dotrino/agent/<tipo>/<nombre>/`. Así se
 * pueden correr dos del mismo tipo a la vez (uno por proyecto) y cada uno es un aparato
 * aparte del acta.
 *
 * Antes cada agente elegía su carpeta (y `ia` usaba la genérica de este paquete), con UN
 * enlace: lanzarlo dos veces arrancaba dos procesos con la MISMA llave, el proxio les
 * repartía los mensajes a los dos y el que no tenía la sesión contestaba «sesión
 * desconocida» en el chat.
 *
 * El nombre es una etiqueta tuya de esta máquina: no viaja, no entra en el acta. Sin
 * `--name`, se BUSCA y solo se exige si hay empate — la misma regla que `dotrino-env`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const DEFAULT_NAME = 'default'
export const isValidName = (n) => typeof n === 'string' && /^[a-z0-9-]{1,32}$/.test(n)

/**
 * Raíz de los agentes de un tipo: `~/.dotrino/agent/<kind>` (override de la raíz común con
 * `DOTRINO_AGENT_HOME`, igual que `DOTRINO_ENV_HOME` en dotrino-env).
 * @param {string} kind  el tipo de agente, el mismo `label` de `startRemoteAgent` (`ia-agent`).
 */
export function instancesRoot (kind) {
  if (!isValidName(kind)) throw new Error(`invalid agent kind "${kind}"`)
  const home = process.env.DOTRINO_AGENT_HOME || path.join(os.homedir(), '.dotrino', 'agent')
  return path.join(home, kind)
}

/** Nombres de las instancias enlazadas (las que tienen `link.json`). */
export function listInstances (kind) {
  const root = instancesRoot(kind)
  let names = []
  try { names = fs.readdirSync(root) } catch (_) { return [] }
  return names.filter((n) => isValidName(n) && fs.existsSync(path.join(root, n, 'link.json'))).sort()
}

/**
 * La carpeta de la instancia a usar.
 *   · con `name`: esa (valida el nombre);
 *   · sin nombre y ninguna enlazada: `default`;
 *   · sin nombre y UNA enlazada: esa;
 *   · sin nombre y VARIAS: se para y se dice cuáles hay. Elegir por el usuario sería adivinar.
 * @returns {{ name: string, dir: string }}
 */
export function resolveInstance (kind, name) {
  if (name != null) {
    if (!isValidName(name)) throw new Error(`invalid name "${name}" (use [a-z0-9-]{1,32}, e.g. "project-a")`)
    return { name, dir: path.join(instancesRoot(kind), name) }
  }
  const found = listInstances(kind)
  if (found.length > 1) throw new Error(`there is more than one agent on this machine (${found.join(', ')}): pick one with --name <name>`)
  const n = found[0] || DEFAULT_NAME
  return { name: n, dir: path.join(instancesRoot(kind), n) }
}

/**
 * Candado de la instancia: dos procesos con el MISMO enlace son la misma llave y se
 * estorban. Si ya corre uno vivo, se para y se dice. Devuelve `release()`.
 */
export function lockInstance (dir) {
  const file = path.join(dir, 'agent.pid')
  try {
    const pid = Number(fs.readFileSync(file, 'utf8'))
    if (pid && pid !== process.pid && isAlive(pid)) {
      throw Object.assign(new Error(`this agent is already running (pid ${pid}). To run another one at the same time, give it its own --name`), { code: 'EALREADY' })
    }
  } catch (e) { if (e.code === 'EALREADY') throw e }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(file, String(process.pid), { mode: 0o600 })
  return () => { try { if (Number(fs.readFileSync(file, 'utf8')) === process.pid) fs.rmSync(file) } catch (_) {} }
}

function isAlive (pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}
