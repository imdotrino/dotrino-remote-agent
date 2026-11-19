/**
 * service.js — un agente como SERVICIO del usuario: arranca solo con la máquina o con la sesión.
 *
 * Venía de `dotrino-terminal/agent/service.js` y ahora es común (CLAUDE.md: reusar es la norma):
 * lo usan el agente de Terminal y el del escritorio remoto. Cada uno lo configura con
 * `makeService({ id, title, runPrefix, agentArgs, linux })` y recibe las órdenes de siempre.
 *
 *   · Linux, `linux: 'systemd'` — una unidad de systemd DEL USUARIO (`~/.config/systemd/user`),
 *     sin `sudo`. Con «linger» arranca al encender, antes de que nadie inicie sesión.
 *   · Linux, `linux: 'autostart'` — el inicio automático del escritorio
 *     (`~/.config/autostart/*.desktop`, XDG) lanza un SUPERVISOR que levanta el agente cada vez
 *     que sale. Para un agente que necesita la SESIÓN GRÁFICA (el escritorio remoto: `DISPLAY`,
 *     el bus de sesión, la accesibilidad): una unidad que arranca al encender no tiene nada de
 *     eso, y `graphical-session.target` no lo activan todos los escritorios (XFCE no siempre).
 *   · macOS — un LaunchAgent (`~/Library/LaunchAgents`): arranca al iniciar sesión.
 *   · Windows — una entrada en `HKCU\…\Run` que lanza el mismo supervisor sin ventana. No es el
 *     Programador de tareas ni un servicio de Windows: los dos piden derechos de administrador.
 *
 * Es de usuario a propósito (CONVENCIONES §15): así el agente se sigue actualizando solo, y con
 * alguien que lo levante (`DOTRINO_SUPERVISED`) ya puede reiniciarse para estrenar la versión.
 *
 * Una unidad por PERFIL: cada perfil es un agente con su enlace.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn as childSpawn } from 'node:child_process'

/** @typedef {Error & { code?: string, stderr?: string | Buffer }} Thrown */

/** @type {(code: string, message: string) => Error & { code: string }} */
const fail = (code, message) => Object.assign(new Error(message), { code })

/** Correr una orden del sistema (`execFileSync`, o su doble en las pruebas). */
/** @typedef {(cmd: string, args: string[], opts?: import('node:child_process').ExecFileSyncOptions) => unknown} RunFn */
/** Lanzar un proceso (`spawn`, o su doble en las pruebas). */
/** @typedef {typeof childSpawn} SpawnFn */
/** Lo que comparten las órdenes de servicio: el perfil, y Node y el CLI con que se lanza. */
/** @typedef {{ name: string, node: string, cli: string }} Launch */
/** @typedef {'systemd' | 'autostart' | 'launchd' | 'run-key'} ServiceKind */

/**
 * Qué agente es.
 * @typedef {object} Product
 * @property {string} id         `terminal-agent` → `dotrino-terminal-agent-<perfil>.service`, `com.dotrino.terminal-agent.<perfil>`
 * @property {string} title      para la descripción de la unidad: `Dotrino Terminal agent`
 * @property {string} runPrefix  el valor de `HKCU\…\Run`: `DotrinoTerminalAgent` → `DotrinoTerminalAgent-<perfil>`
 * @property {(name: string) => string[]} agentArgs  con qué argumentos se corre el agente sin TTY
 * @property {'systemd' | 'autostart'} [linux]  cómo se pone en Linux (por defecto, systemd)
 */

/** Windows: la clave de lo que arranca al iniciar sesión. */
export const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
/** Cuánto espera el supervisor antes de volver a levantar el agente (como `RestartSec`). */
export const RESTART_MS = 3000
/** @param {string} dir */
export const supervisorPidFile = (dir) => path.join(dir, 'supervisor.pid')

/** systemd parte `ExecStart` por espacios: lo que los lleve va entre comillas. */
/** @param {string} s */
const unitArg = (s) => (/[\s"'\\$%]/.test(s) ? `"${s.replace(/[\\"]/g, '\\$&').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"` : s)

/**
 * Un argumento de `Exec=` de un `.desktop` (especificación XDG): entre comillas dobles si lleva
 * algo reservado, con `"`, `` ` ``, `$` y `\` escapados, y el `%` doblado (son los códigos de campo).
 * La barra va cuádruple: primero se aplica el escape de las cadenas y después el de las comillas.
 * @param {string} s
 */
export const desktopArg = (s) => {
  const v = s.replace(/%/g, '%%')
  if (!/[\s"'\\$`<>~|&;*?#()]/.test(v)) return v
  return `"${v.replace(/\\/g, '\\\\\\\\').replace(/["`$]/g, '\\$&')}"`
}

/** @param {unknown} s */
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * @param {RunFn} run
 * @param {string} cmd
 * @param {string[]} args
 * @returns {{ ok: true } | { ok: false, reason: string | undefined }}
 */
function quiet (run, cmd, args) {
  try { run(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true }); return { ok: true } } catch (e) {
    return { ok: false, reason: String(/** @type {Thrown} */ (e).stderr || /** @type {Thrown} */ (e).message).trim().split('\n').pop() }
  }
}

/**
 * @param {RunFn} run
 * @param {string} cmd
 * @param {string[]} args
 */
function must (run, cmd, args) {
  const r = quiet(run, cmd, args)
  if (!r.ok) throw fail('service-command-failed', `${cmd} ${args.join(' ')}: ${r.reason}`)
}

const LINGER_DIR = '/var/lib/systemd/linger'
/** ¿Ya arrancan los servicios de ese usuario al encender? systemd lo apunta con un archivo. */
/** @type {(user: string, root?: string) => boolean} */
const lingers = (user, root = LINGER_DIR) => fs.existsSync(path.join(root, user))

/** @type {(file: string) => number} */
const readPid = (file) => { try { return Number(fs.readFileSync(file, 'utf8')) || 0 } catch (e) { if (/** @type {Thrown} */ (e).code === 'ENOENT') return 0; throw e } }
/** @type {(pid: number) => boolean} */
const alive = (pid) => { try { process.kill(pid, 0); return true } catch (e) { return /** @type {Thrown} */ (e).code === 'EPERM' } }

/** PowerShell: una cadena entre comillas simples. */
/** @param {string} s */
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

/** ¿Hay sesión gráfica en este entorno? Sin ella, un agente de `autostart` no puede arrancar ahora. */
/** @param {NodeJS.ProcessEnv} env */
const graphical = (env) => !!(env.DISPLAY || env.WAYLAND_DISPLAY)

/**
 * El supervisor: levanta el agente del perfil y lo vuelve a levantar cada vez que sale (también
 * cuando se reinicia para estrenar una versión: §15, `DOTRINO_SUPERVISED`). Uno por perfil: si
 * ya hay otro vivo, lanza `already-supervised`.
 * @param {{ name: string, dir: string, node?: string, cli: string, args: string[], spawn?: SpawnFn }} o
 */
export function supervise ({ name, dir, node = process.execPath, cli, args, spawn = childSpawn }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const pidFile = supervisorPidFile(dir)
  const other = readPid(pidFile)
  if (other && other !== process.pid && alive(other)) throw fail('already-supervised', `profile ${name} already has a supervisor (pid ${other})`)
  fs.writeFileSync(pidFile, String(process.pid))
  let stopped = false
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null
  const start = () => {
    const fd = fs.openSync(path.join(dir, 'agent.log'), 'a', 0o600)
    child = spawn(node, [cli, ...args], { windowsHide: true, stdio: ['ignore', fd, fd], env: { ...process.env, DOTRINO_SUPERVISED: '1' } })
    fs.closeSync(fd)
    child.on('exit', () => { child = null; if (!stopped) setTimeout(start, RESTART_MS) })
  }
  start()
  return {
    stop: () => {
      stopped = true
      try { child?.kill() } catch (_) {}
      try { if (readPid(pidFile) === process.pid) fs.rmSync(pidFile) } catch (_) {}
    }
  }
}

/**
 * Para el supervisor y después el agente. En Windows matar el supervisor no se lleva al hijo
 * (no hay señales: `agent.pid`, si el agente lo escribe); en Linux el supervisor para a su hijo
 * al recibir SIGTERM.
 * @param {string} dir
 */
function stopSupervised (dir) {
  for (const file of [supervisorPidFile(dir), path.join(dir, 'agent.pid')]) {
    const pid = readPid(file)
    if (pid && alive(pid)) process.kill(pid)
  }
  fs.rmSync(supervisorPidFile(dir), { force: true })
}

/**
 * Las órdenes de servicio de un agente.
 * @param {Product} product
 */
export function makeService ({ id, title, runPrefix, agentArgs, linux = 'systemd' }) {
  /** @param {string} name */
  const unitName = (name) => `dotrino-${id}-${name}.service`
  /** @param {string} name */
  const plistLabel = (name) => `com.dotrino.${id}.${name}`
  /** @param {string} name */
  const runValue = (name) => `${runPrefix}-${name}`
  /** @param {string} name @param {string} [home] */
  const unitPath = (name, home = os.homedir()) => path.join(home, '.config', 'systemd', 'user', unitName(name))
  /** @param {string} name @param {string} [home] */
  const plistPath = (name, home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents', `${plistLabel(name)}.plist`)
  /** @param {string} name @param {string} [home] */
  const autostartPath = (name, home = os.homedir()) => path.join(home, '.config', 'autostart', `dotrino-${id}-${name}.desktop`)
  /** Lo que se apunta en la clave de Windows: Node, el CLI y el supervisor del perfil. */
  /** @param {Launch} o */
  const runCommand = ({ name, node, cli }) => `"${node}" "${cli}" supervise --name ${name}`
  /** @param {string} name */
  const runKeyFile = (name) => `${RUN_KEY}\\${runValue(name)}`
  /** @type {(name: string, run: RunFn) => boolean} */
  const hasRunKey = (name, run) => quiet(run, 'reg', ['query', RUN_KEY, '/v', runValue(name)]).ok

  /**
   * La unidad de systemd. El PATH es el de quien instala: el de un servicio de usuario es mínimo
   * y no trae el Node de nvm ni las herramientas que el agente espera encontrar.
   * @param {Launch & { pathEnv: string }} o
   */
  function unitText ({ name, node, cli, pathEnv }) {
    return `[Unit]
Description=${title} (${name})
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=${[node, cli, ...agentArgs(name)].map(unitArg).join(' ')}
Environment=${unitArg(`PATH=${pathEnv}`)}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
`
  }

  /**
   * La entrada del inicio automático del escritorio: lanza el supervisor del perfil. El entorno
   * (PATH, DISPLAY, el bus de sesión) es el de la sesión, que es justo lo que hace falta.
   * @param {Launch} o
   */
  function autostartText ({ name, node, cli }) {
    return `[Desktop Entry]
Type=Application
Name=${title} (${name})
Exec=${[node, cli, 'supervise', '--name', name].map(desktopArg).join(' ')}
Terminal=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
`
  }

  /**
   * El LaunchAgent de macOS. `DOTRINO_SUPERVISED`: launchd lo levanta si sale (§15).
   * @param {Launch & { pathEnv: string, log: string }} o
   */
  function plistText ({ name, node, cli, pathEnv, log }) {
    const args = [node, cli, ...agentArgs(name)].map((a) => `    <string>${xml(a)}</string>`).join('\n')
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(plistLabel(name))}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${xml(pathEnv)}</string>
    <key>DOTRINO_SUPERVISED</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`
  }

  /**
   * ¿Deja este sistema instalar el servicio? Lanza con el motivo si no.
   * @param {{ platform: string, run: RunFn }} o
   * @returns {ServiceKind}
   */
  function platformOf ({ platform, run }) {
    if (platform === 'darwin') return 'launchd'
    if (platform === 'win32') return 'run-key'
    if (platform !== 'linux') throw fail('unsupported-platform', `there is no service support for ${platform}`)
    if (linux === 'autostart') return 'autostart'
    // Sin systemd de usuario (un contenedor, WSL sin systemd, otra init) no hay dónde ponerlo.
    if (!quiet(run, 'systemctl', ['--user', 'show-environment']).ok) throw fail('no-user-systemd', 'this session has no systemd user manager')
    return 'systemd'
  }

  /**
   * Lanza el supervisor del perfil, ya suelto (sin ventana en Windows, en su propia sesión en Linux).
   *
   * Windows desde SSH no vale un proceso aparte: sshd mete la sesión en un objeto de trabajo y al
   * cerrarla mata todo lo que lanzó. Ahí lo crea WMI (`Win32_Process.Create`) con la misma línea
   * que queda en `HKCU\…\Run`; una cuenta sin administrador no puede, y se devuelve el motivo.
   *
   * Linux (`autostart`) sin sesión gráfica en este entorno (por SSH): el agente no arrancaría.
   * No se lanza nada y se dice; el inicio automático lo arranca al iniciar sesión.
   *
   * @param {Launch & { platform: string, spawn: SpawnFn, run: RunFn, env: NodeJS.ProcessEnv }} o
   * @returns {{ ok: true } | { ok: false, reason: string }}
   */
  function spawnSupervisor ({ name, node, cli, platform, spawn, run, env }) {
    if (platform === 'win32' && (env.SSH_CONNECTION || env.SSH_CLIENT)) {
      const script = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(runCommand({ name, node, cli }))} }; if ($r.ReturnValue -ne 0) { throw "Win32_Process.Create returned $($r.ReturnValue)" }`
      const r = quiet(run, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
      return r.ok ? { ok: true } : { ok: false, reason: 'Windows (WMI) does not let this account start it from SSH' }
    }
    if (platform === 'linux' && !graphical(env)) return { ok: false, reason: 'there is no graphical session here (DISPLAY / WAYLAND_DISPLAY)' }
    const child = spawn(node, [cli, 'supervise', '--name', name], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...env, DOTRINO_SUPERVISOR: '1' } })
    child.unref()
    return { ok: true }
  }

  /**
   * La orden `supervise` del CLI del agente. La lanza el sistema (la entrada de `Run`, el inicio
   * automático del escritorio): primero se vuelve a lanzar suelto y sale (en Windows se abre CON
   * ventana), y ese segundo proceso es el supervisor. Para con SIGINT/SIGTERM y se lleva al agente.
   * @param {{ name: string, dir: string, cli: string, node?: string, spawn?: SpawnFn, env?: NodeJS.ProcessEnv }} o
   */
  function superviseCommand ({ name, dir, cli, node = process.execPath, spawn = childSpawn, env = process.env }) {
    if (!env.DOTRINO_SUPERVISOR) {
      spawn(node, [cli, 'supervise', '--name', name], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...env, DOTRINO_SUPERVISOR: '1' } }).unref()
      return { relaunched: true }
    }
    const s = supervise({ name, dir, node, cli, args: agentArgs(name), spawn })
    const bye = () => { s.stop(); process.exit(0) }
    process.on('SIGINT', bye); process.on('SIGTERM', bye)
    return { relaunched: false, stop: s.stop }
  }

  /**
   * Instala y enciende el servicio del perfil `name`.
   *
   * `running`: ya hay un agente de ese perfil corriendo por su cuenta. Dos agentes con el mismo
   * enlace son la misma llave: el servicio queda puesto y toma el relevo cuando ese termine o al
   * próximo arranque.
   *
   * @param {{ name: string, node?: string, cli: string, dir: string, running?: boolean, pathEnv?: string, platform?: string, home?: string,
   *   user?: string, uid?: number, run?: RunFn, spawn?: SpawnFn, env?: NodeJS.ProcessEnv }} o
   * @returns {{ kind: ServiceKind, file: string, started: boolean, boot?: boolean, lingerReason?: string, startReason?: string }}
   */
  function installService ({ name, node = process.execPath, cli, dir, running = false, pathEnv = process.env.PATH || '', platform = process.platform, home = os.homedir(), user = os.userInfo().username, uid = process.getuid?.(), run = execFileSync, spawn = childSpawn, env = process.env }) {
    const kind = platformOf({ platform, run })
    if (kind === 'run-key' || kind === 'autostart') {
      let file
      if (kind === 'run-key') {
        must(run, 'reg', ['add', RUN_KEY, '/v', runValue(name), '/t', 'REG_SZ', '/d', runCommand({ name, node, cli }), '/f'])
        file = runKeyFile(name)
      } else {
        file = autostartPath(name, home)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, autostartText({ name, node, cli }), { mode: 0o644 })
      }
      if (running) return { kind, file, started: false }
      const pid = readPid(supervisorPidFile(dir))
      if (pid && alive(pid)) return { kind, file, started: true }
      const s = spawnSupervisor({ name, node, cli, platform, spawn, run, env })
      return { kind, file, started: s.ok, ...(s.ok ? {} : { startReason: s.reason }) }
    }
    if (kind === 'launchd') {
      const file = plistPath(name, home)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, plistText({ name, node, cli, pathEnv, log: path.join(dir, 'agent.log') }), { mode: 0o644 })
      if (running) return { kind, file, started: false }
      // Si ya estaba cargado (una instalación anterior), se recarga con el archivo nuevo.
      quiet(run, 'launchctl', ['bootout', `gui/${uid}/${plistLabel(name)}`])
      must(run, 'launchctl', ['bootstrap', `gui/${uid}`, file])
      return { kind, file, started: true }
    }
    const file = unitPath(name, home)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, unitText({ name, node, cli, pathEnv }), { mode: 0o644 })
    must(run, 'systemctl', ['--user', 'daemon-reload'])
    must(run, 'systemctl', ['--user', 'enable', unitName(name)])
    if (!running) must(run, 'systemctl', ['--user', 'restart', unitName(name)])
    // Arrancar al ENCENDER, sin que nadie inicie sesión. Si el sistema no lo deja sin
    // administrador, el servicio arranca al iniciar sesión, y se dice.
    if (lingers(user)) return { kind, file, started: !running, boot: true }
    const linger = quiet(run, 'loginctl', ['enable-linger', user])
    return { kind, file, started: !running, boot: linger.ok, ...(linger.ok ? {} : { lingerReason: linger.reason }) }
  }

  /**
   * Arranca el servicio ya instalado de ese perfil. `false` si el perfil no tiene servicio (o no
   * se puede dejar corriendo desde aquí): entonces quien llama levanta el agente él mismo.
   * @param {{ name: string, dir: string, node?: string, cli: string, platform?: string, home?: string, uid?: number,
   *   run?: RunFn, spawn?: SpawnFn, env?: NodeJS.ProcessEnv }} o
   * @returns {boolean}
   */
  function startService ({ name, dir, node = process.execPath, cli, platform = process.platform, home = os.homedir(), uid = process.getuid?.(), run = execFileSync, spawn = childSpawn, env = process.env }) {
    if (platform === 'win32' || (platform === 'linux' && linux === 'autostart')) {
      if (platform === 'win32' ? !hasRunKey(name, run) : !fs.existsSync(autostartPath(name, home))) return false
      const pid = readPid(supervisorPidFile(dir))
      if (pid && alive(pid)) return true
      return spawnSupervisor({ name, node, cli, platform, spawn, run, env }).ok
    }
    if (platform === 'darwin') {
      const file = plistPath(name, home)
      if (!fs.existsSync(file)) return false
      // Cargado y parado no puede estar (KeepAlive): si no corre, es que no está cargado.
      quiet(run, 'launchctl', ['bootout', `gui/${uid}/${plistLabel(name)}`])
      must(run, 'launchctl', ['bootstrap', `gui/${uid}`, file])
      return true
    }
    if (platform !== 'linux' || !fs.existsSync(unitPath(name, home))) return false
    must(run, 'systemctl', ['--user', 'start', unitName(name)])
    return true
  }

  /**
   * Para el servicio y lo quita. El enlace y los ajustes del perfil no se tocan.
   * @param {{ name: string, dir: string, platform?: string, home?: string, uid?: number, run?: RunFn }} o
   * @returns {{ kind: ServiceKind, file: string, removed: boolean }}
   */
  function uninstallService ({ name, dir, platform = process.platform, home = os.homedir(), uid = process.getuid?.(), run = execFileSync }) {
    const kind = platformOf({ platform, run })
    if (kind === 'run-key') {
      if (!hasRunKey(name, run)) return { kind, file: runKeyFile(name), removed: false }
      stopSupervised(dir)
      must(run, 'reg', ['delete', RUN_KEY, '/v', runValue(name), '/f'])
      return { kind, file: runKeyFile(name), removed: true }
    }
    if (kind === 'autostart') {
      const file = autostartPath(name, home)
      if (!fs.existsSync(file)) return { kind, file, removed: false }
      stopSupervised(dir)
      fs.rmSync(file)
      return { kind, file, removed: true }
    }
    const file = kind === 'launchd' ? plistPath(name, home) : unitPath(name, home)
    if (!fs.existsSync(file)) return { kind, file, removed: false }
    if (kind === 'launchd') quiet(run, 'launchctl', ['bootout', `gui/${uid}/${plistLabel(name)}`])
    else must(run, 'systemctl', ['--user', 'disable', '--now', unitName(name)])
    fs.rmSync(file)
    if (kind === 'systemd') must(run, 'systemctl', ['--user', 'daemon-reload'])
    return { kind, file, removed: true }
  }

  /**
   * ¿Está puesto, y está corriendo ahora bajo el sistema?
   * @param {{ name: string, dir: string, platform?: string, home?: string, uid?: number, run?: RunFn }} o
   * @returns {{ kind: ServiceKind, file: string, installed: boolean, active: boolean }}
   */
  function serviceStatus ({ name, dir, platform = process.platform, home = os.homedir(), uid = process.getuid?.(), run = execFileSync }) {
    const kind = platformOf({ platform, run })
    if (kind === 'run-key' || kind === 'autostart') {
      const installed = kind === 'run-key' ? hasRunKey(name, run) : fs.existsSync(autostartPath(name, home))
      const pid = installed ? readPid(supervisorPidFile(dir)) : 0
      return { kind, file: kind === 'run-key' ? runKeyFile(name) : autostartPath(name, home), installed, active: !!pid && alive(pid) }
    }
    const file = kind === 'launchd' ? plistPath(name, home) : unitPath(name, home)
    const installed = fs.existsSync(file)
    const active = installed && (kind === 'launchd'
      ? quiet(run, 'launchctl', ['print', `gui/${uid}/${plistLabel(name)}`]).ok
      : quiet(run, 'systemctl', ['--user', 'is-active', '--quiet', unitName(name)]).ok)
    return { kind, file, installed, active }
  }

  return {
    installService, uninstallService, serviceStatus, startService, superviseCommand,
    unitText, autostartText, plistText, unitName, unitPath, plistLabel, plistPath, autostartPath, runValue, runCommand
  }
}
