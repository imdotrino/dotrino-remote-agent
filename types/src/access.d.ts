/** Si esta máquina tiene clave. Un archivo que existe y no se puede leer NO es «sin clave»: se lanza. */
/** @param {string} dir */
export function hasAccessCode(dir: string): boolean;
/**
 * Pone o cambia la clave.
 * @param {string} dir
 * @param {unknown} secret
 */
export function setAccessCode(dir: string, secret: unknown): void;
/**
 * Quita la clave.
 * @param {string} dir
 */
export function clearAccessCode(dir: string): void;
/**
 * Si `secret` es la clave de esta máquina. Sin frenos: para la orden local que la cambia.
 * @param {string} dir
 * @param {unknown} secret
 */
export function checkAccessCode(dir: string, secret: unknown): boolean;
/**
 * La puerta de un agente: comprueba la clave y frena los fallos seguidos. Una por agente,
 * compartida por todas sus sesiones.
 * @param {string} dir
 * @param {{ now?: () => number, onIncident?: ((i: { device: string, tries: number }) => void) | null }} [opts]
 *   `onIncident`: un mismo aparato (`device`, su pubkey) falló `INCIDENT_AFTER` veces seguidas.
 *   Se llama UNA vez por racha; la racha se corta al acertar.
 */
export function makeGate(dir: string, { now, onIncident }?: {
    now?: () => number;
    onIncident?: ((i: {
        device: string;
        tries: number;
    }) => void) | null;
}): {
    /** Si hay que escribir la clave para entrar. Lanza `access-unreadable` si no se puede saber. */
    required: () => boolean;
    /**
     * Lanza `wait` (con `retryMs`) o `bad-code`; si no lanza, la clave era la buena.
     * `device` es quién la escribió (pubkey), para contar sus fallos y avisar.
     */
    /**
     * @param {unknown} secret
     * @param {string | null} [device]
     */
    check(secret: unknown, device?: string | null): void;
};
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
export function makeLock({ gate, device, send }: {
    gate: ReturnType<typeof makeGate> | null;
    device?: string | null;
    send: (msg: object) => unknown;
}): {
    readonly unlocked: boolean;
    /** True si esta sesión puede seguir; si no, ya contestó por qué. */
    mayPass(): boolean;
    /** Si `msg` es el `unlock`, lo atiende y devuelve true. @param {any} msg */
    handle(msg: any): boolean;
};
/**
 * Pregunta algo que no debe verse al teclearlo. Solo en una TTY: una clave no se pasa por una
 * tubería (`no-tty`). Ctrl+C sale (130).
 * @param {string} q
 * @returns {Promise<string>}
 */
export function askHidden(q: string): Promise<string>;
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
export function lockCommand({ dir, args, lang, what, localNote }: {
    dir: string;
    args: string[];
    lang?: "es" | "en";
    what: {
        es: string;
        en: string;
    };
    localNote?: {
        es: string;
        en: string;
    } | null;
}): Promise<string>;
export const ACCESS_FILE: "access.json";
export const MIN_LENGTH: 4;
/** Fallos seguidos que se dejan pasar sin esperar: al tercero empieza la espera. */
export const FREE_TRIES: 3;
/** Fallos seguidos de un mismo aparato que disparan el aviso a la bóveda. */
export const INCIDENT_AFTER: 3;
export type Thrown = Error & {
    code?: string;
    retryMs?: number;
};
