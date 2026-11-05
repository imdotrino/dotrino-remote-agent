/** @typedef {import('./shapes.js').AgentIdentity} AgentIdentity */
/** @typedef {import('./shapes.js').DotrinoActa} DotrinoActa */
/**
 * @param {AgentIdentity} id   instancia de Identity (del vault) ya conectada.
 * @param {string} [label]  filtrar por servicio/label exacto (p. ej. `'content'`,
 *   `'ia-agent'`). Omitir = todos los que tengan nameOf y no sean `'cli'` (un navegador
 *   enrolado queda como `cli` y no atiende a nadie).
 * @param {{ fresh?: boolean }} [opts]  `fresh: false`: el acta guardada, sin preguntar a la
 *   bóveda (si no hay ninguna guardada, se pregunta igual).
 * @returns {Promise<Array<{sub:string,label:string,cn:string|null}>>} uno por miembro.
 * @throws `code: 'no-record'` si ni la bóveda ni lo guardado dan el acta: no se sabe, y no es «ninguno».
 */
export function listAgentsByLabel(id: AgentIdentity, label?: string, { fresh }?: {
    fresh?: boolean;
}): Promise<Array<{
    sub: string;
    label: string;
    cn: string | null;
}>>;
/**
 * QUÉ AGENTE ES CADA UNO, preguntándoselo. Manda un `ra.ping` a cada pubkey por el
 * transporte que se le pase y devuelve los que contestan, con el `kind` que declara el
 * agente al arrancar (`startRemoteAgent({ label })`).
 *
 * Existe porque buscar por el label del ACTA no sirve: ese nombre lo pone el dueño al
 * emparejar («TerminalLocal», «el PC de la oficina»), así que una app que buscaba
 * `terminal-agent` no encontraba nada. Lo que un agente atiende lo sabe el agente.
 *
 * Un agente apagado no contesta y no sale: no se puede saber qué es sin preguntarle.
 *
 * @param {{ on: (ev: 'message', fn: (from: string, p: any) => void) => () => void, sendByPubkey: (to: string, payload: object, opts?: { ephemeral?: boolean }) => unknown } | null} client
 *   un WebSocketProxyClient conectado. `p` es lo que llega: se mira su `type` antes de usarlo.
 * @param {string[]} subs  pubkeys a preguntar (p. ej. las de `listAgentsByLabel(id)`).
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Map<string, { kind: string|null }>>} sub → lo que contestó.
 */
export function probeAgents(client: {
    on: (ev: "message", fn: (from: string, p: any) => void) => () => void;
    sendByPubkey: (to: string, payload: object, opts?: {
        ephemeral?: boolean;
    }) => unknown;
} | null, subs: string[], { timeoutMs }?: {
    timeoutMs?: number;
}): Promise<Map<string, {
    kind: string | null;
}>>;
declare namespace _default {
    export { listAgentsByLabel };
    export { probeAgents };
}
export default _default;
export type AgentIdentity = import("./shapes.js").AgentIdentity;
export type DotrinoActa = import("./shapes.js").DotrinoActa;
