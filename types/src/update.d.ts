/**
 * Lo que un agente le dice a SU bóveda sobre actualizarse: los tres ganchos de
 * `vaultUpdateHooks`, armados EN CADA LLAMADA con el enlace leído del disco. El papel se renueva
 * mientras el agente corre, y el agente puede arrancar sin enlace y enlazarse después: una
 * conexión fijada al arrancar se quedaría vieja.
 *
 * @param {{ dir: string, product: string, log?: (m: string) => void, load?: (dir: string) => any, make?: typeof vaultUpdateHooks }} o
 * @returns {import('@dotrino/vault/service').UpdateHooks}
 */
export function vaultHooks({ dir, product, log, load, make }: {
    dir: string;
    product: string;
    log?: (m: string) => void;
    load?: (dir: string) => any;
    make?: typeof vaultUpdateHooks;
}): import("@dotrino/vault/service").UpdateHooks;
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
export function startSelfUpdate({ pkg, repo, tag, label, dir, version, busy, close, exit, log, watch, hooks, idleCheckMs }: {
    pkg: string;
    repo: string;
    tag: (version: string) => string;
    label: string;
    dir: string;
    version: string;
    busy: () => number;
    close: () => unknown;
    exit?: (code: number) => void;
    log?: (m: string) => void;
    watch?: typeof watchSelfUpdateNpm;
    hooks?: import("@dotrino/vault/service").UpdateHooks;
    idleCheckMs?: number;
}): () => void;
/** Cada cuánto se mira si ya está libre para reiniciar con la versión instalada. */
export const IDLE_CHECK_MS: 60000;
declare namespace _default {
    export { startSelfUpdate };
    export { vaultHooks };
    export { IDLE_CHECK_MS };
}
export default _default;
import { vaultUpdateHooks } from '@dotrino/vault/service';
import { watchSelfUpdateNpm } from '@dotrino/update/npm';
