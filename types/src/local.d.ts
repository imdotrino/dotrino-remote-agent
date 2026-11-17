/**
 * Escucha las ventanas locales. Cada conexión es una sesión con la misma forma que las de
 * `@dotrino/remote-agent` (`send`, `on('message'|'close')`), así que `serve` es
 * `serveSession` tal cual.
 *
 * @param {{ dir: string, name: string, serve: (session: LocalSession) => void, platform?: string }} opts
 *   `name`: el del socket (`<name>.sock`) y el de la tubería en Windows.
 * @returns {Promise<{ path: string, close: () => void }>}
 */
export function listenLocal({ dir, name, serve, platform }: {
    dir: string;
    name: string;
    serve: (session: LocalSession) => void;
    platform?: string;
}): Promise<{
    path: string;
    close: () => void;
}>;
/**
 * Se conecta al agente de esta máquina. Rechaza con `code: 'ENOAGENT'` si no hay ninguno
 * escuchando en esa carpeta.
 *
 * @param {string} dir  la carpeta del enlace del agente.
 * @param {{ name: string, platform?: string }} opts  `name`: el mismo que en `listenLocal`.
 * @returns {Promise<{ send:(obj:object)=>void, on:(ev:'message'|'close', cb:(msg?: any) => void)=>void, close:()=>void }>}
 */
export function connectLocal(dir: string, { name, platform }: {
    name: string;
    platform?: string;
}): Promise<{
    send: (obj: object) => void;
    on: (ev: "message" | "close", cb: (msg?: any) => void) => void;
    close: () => void;
}>;
export function socketPath(dir: string, name: string): string;
export function pipeFile(dir: string, name: string): string;
/** Lo más largo que admite la ruta de un socket Unix (macOS: 104 bytes con el nulo; Linux: 108). */
export const MAX_SOCKET_PATH: 103;
declare namespace _default {
    export { listenLocal };
    export { connectLocal };
    export { socketPath };
    export { pipeFile };
}
export default _default;
/**
 * Una sesión local: la misma forma que las de `startRemoteAgent`.
 */
export type LocalSession = {
    device: string | null;
    send: (payload: object) => Promise<void>;
    on: (ev: "message" | "close", cb: (msg?: any) => void) => LocalSession;
};
export type Thrown = NodeJS.ErrnoException;
export type Handlers = Record<"message" | "close", ((msg?: any) => void)[]>;
