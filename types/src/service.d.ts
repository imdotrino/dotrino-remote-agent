/**
 * El supervisor: levanta el agente del perfil y lo vuelve a levantar cada vez que sale (también
 * cuando se reinicia para estrenar una versión: §15, `DOTRINO_SUPERVISED`). Uno por perfil: si
 * ya hay otro vivo, lanza `already-supervised`.
 * @param {{ name: string, dir: string, node?: string, cli: string, args: string[], spawn?: SpawnFn }} o
 */
export function supervise({ name, dir, node, cli, args, spawn }: {
    name: string;
    dir: string;
    node?: string;
    cli: string;
    args: string[];
    spawn?: SpawnFn;
}): {
    stop: () => void;
};
/**
 * Las órdenes de servicio de un agente.
 * @param {Product} product
 */
export function makeService({ id, title, runPrefix, agentArgs, linux }: Product): {
    installService: ({ name, node, cli, dir, running, pathEnv, platform, home, user, uid, run, spawn, env }: {
        name: string;
        node?: string;
        cli: string;
        dir: string;
        running?: boolean;
        pathEnv?: string;
        platform?: string;
        home?: string;
        user?: string;
        uid?: number;
        run?: RunFn;
        spawn?: SpawnFn;
        env?: NodeJS.ProcessEnv;
    }) => {
        kind: ServiceKind;
        file: string;
        started: boolean;
        boot?: boolean;
        lingerReason?: string;
        startReason?: string;
    };
    uninstallService: ({ name, dir, platform, home, uid, run }: {
        name: string;
        dir: string;
        platform?: string;
        home?: string;
        uid?: number;
        run?: RunFn;
    }) => {
        kind: ServiceKind;
        file: string;
        removed: boolean;
    };
    serviceStatus: ({ name, dir, platform, home, uid, run }: {
        name: string;
        dir: string;
        platform?: string;
        home?: string;
        uid?: number;
        run?: RunFn;
    }) => {
        kind: ServiceKind;
        file: string;
        installed: boolean;
        active: boolean;
    };
    startService: ({ name, dir, node, cli, platform, home, uid, run, spawn, env }: {
        name: string;
        dir: string;
        node?: string;
        cli: string;
        platform?: string;
        home?: string;
        uid?: number;
        run?: RunFn;
        spawn?: SpawnFn;
        env?: NodeJS.ProcessEnv;
    }) => boolean;
    superviseCommand: ({ name, dir, cli, node, spawn, env }: {
        name: string;
        dir: string;
        cli: string;
        node?: string;
        spawn?: SpawnFn;
        env?: NodeJS.ProcessEnv;
    }) => {
        relaunched: boolean;
        stop?: undefined;
    } | {
        relaunched: boolean;
        stop: () => void;
    };
    unitText: ({ name, node, cli, pathEnv }: Launch & {
        pathEnv: string;
    }) => string;
    autostartText: ({ name, node, cli }: Launch) => string;
    plistText: ({ name, node, cli, pathEnv, log }: Launch & {
        pathEnv: string;
        log: string;
    }) => string;
    unitName: (name: string) => string;
    unitPath: (name: string, home?: string) => string;
    plistLabel: (name: string) => string;
    plistPath: (name: string, home?: string) => string;
    autostartPath: (name: string, home?: string) => string;
    runValue: (name: string) => string;
    runCommand: ({ name, node, cli }: Launch) => string;
};
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
export const RUN_KEY: "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
/** Cuánto espera el supervisor antes de volver a levantar el agente (como `RestartSec`). */
export const RESTART_MS: 3000;
export function supervisorPidFile(dir: string): string;
export function desktopArg(s: string): string;
export type Thrown = Error & {
    code?: string;
    stderr?: string | Buffer;
};
export type RunFn = (cmd: string, args: string[], opts?: import("node:child_process").ExecFileSyncOptions) => unknown;
export type SpawnFn = typeof childSpawn;
export type Launch = {
    name: string;
    node: string;
    cli: string;
};
export type ServiceKind = "systemd" | "autostart" | "launchd" | "run-key";
/**
 * Qué agente es.
 */
export type Product = {
    /**
     * `terminal-agent` → `dotrino-terminal-agent-<perfil>.service`, `com.dotrino.terminal-agent.<perfil>`
     */
    id: string;
    /**
     * para la descripción de la unidad: `Dotrino Terminal agent`
     */
    title: string;
    /**
     * el valor de `HKCU\…\Run`: `DotrinoTerminalAgent` → `DotrinoTerminalAgent-<perfil>`
     */
    runPrefix: string;
    /**
     * con qué argumentos se corre el agente sin TTY
     */
    agentArgs: (name: string) => string[];
    /**
     * cómo se pone en Linux (por defecto, systemd)
     */
    linux?: "systemd" | "autostart" | undefined;
};
import { spawn as childSpawn } from 'node:child_process';
