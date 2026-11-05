/**
 * Raíz de los agentes de un tipo: `~/.dotrino/agent/<kind>` (override de la raíz común con
 * `DOTRINO_AGENT_HOME`, igual que `DOTRINO_ENV_HOME` en dotrino-env).
 * @param {string} kind  el tipo de agente, el mismo `label` de `startRemoteAgent` (`ia-agent`).
 */
export function instancesRoot(kind: string): string;
/**
 * Nombres de las instancias enlazadas (las que tienen `link.json`).
 * @param {string} kind
 * @returns {string[]}
 */
export function listInstances(kind: string): string[];
/**
 * La carpeta de la instancia a usar.
 *   · con `name`: esa (valida el nombre);
 *   · sin nombre y ninguna enlazada: `default`;
 *   · sin nombre y UNA enlazada: esa;
 *   · sin nombre y VARIAS: se para y se dice cuáles hay. Elegir por el usuario sería adivinar.
 * @param {string} kind
 * @param {string | null} [name]
 * @returns {{ name: string, dir: string }}
 */
export function resolveInstance(kind: string, name?: string | null): {
    name: string;
    dir: string;
};
/**
 * Candado de la instancia: dos procesos con el MISMO enlace son la misma llave y se
 * estorban. Si ya corre uno vivo, se para y se dice. Devuelve `release()`.
 */
/** @param {string} dir @returns {() => void} suelta el candado */
export function lockInstance(dir: string): () => void;
export const DEFAULT_NAME: "default";
export function isValidName(n: unknown): n is string;
