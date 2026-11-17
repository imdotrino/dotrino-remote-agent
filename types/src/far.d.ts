/** @typedef {import('./link.js').AgentLink} AgentLink */
/** Una máquina de la cuenta con un agente del tipo buscado encendido. */
/** @typedef {{ sub: string, id: string, name: string }} FoundAgent */
/**
 * Lo que se guarda entre una búsqueda y la siguiente: la conexión con la que se pregunta quién
 * contesta, y cuándo se le pidió el acta a la bóveda por última vez.
 * @typedef {{ probe: import('@dotrino/proxy-client').WebSocketProxyClient | null, askedVaultAt?: number }} DiscoverState
 */
/**
 * Las máquinas de la cuenta con un agente de tipo `kind` encendido (las que contestan al ping
 * diciendo que son de ese tipo).
 * @param {{ link: AgentLink, dir: string, kind: string, state: DiscoverState, membersMs?: number }} o
 * @returns {Promise<FoundAgent[]>}
 */
export function discoverAgents({ link, dir, kind, state, membersMs }: {
    link: AgentLink;
    dir: string;
    kind: string;
    state: DiscoverState;
    membersMs?: number;
}): Promise<FoundAgent[]>;
/**
 * Una sesión con el agente de otra máquina.
 *
 * EL ACTA DE CONFIANZA DE ESTE AGENTE se lee del disco en cada saludo: la mantiene al día su
 * lado de agente. Sin ella el cliente le pedía el acta a la bóveda en cada conexión, y la
 * ventana esperaba 4-17 s (2026-11-04). Si con ella no pasa, el cliente sí pregunta a la bóveda.
 *
 * @param {{ link: AgentLink, dir: string, sub: string, loadLink?: () => AgentLink | null }} o
 * @returns {Promise<RemoteAgentClient>}
 */
export function connectAgent({ link, dir, sub, loadLink }: {
    link: AgentLink;
    dir: string;
    sub: string;
    loadLink?: () => AgentLink | null;
}): Promise<RemoteAgentClient>;
/**
 * LO QUE FALLA QUEDA ESCRITO, CON SU HORA, y solo al CAMBIAR (falla, cambia de motivo o se
 * recupera): el refresco va cada pocos segundos y una línea por vuelta ahogaría el log.
 * @param {(line: string) => void} log
 * @returns {(what: string, failure: unknown, ms?: number) => void}
 */
export function failureLog(log: (line: string) => void): (what: string, failure: unknown, ms?: number) => void;
/**
 * Cada cuánto se le pide el acta a la BÓVEDA. Entre medias vale la guardada, que el agente ya
 * refresca solo. Pedirla en cada vuelta no dejaba dormirse a la bóveda de Lambda (2026-10-25).
 */
export const MEMBERS_MS: number;
declare namespace _default {
    export { discoverAgents };
    export { connectAgent };
    export { failureLog };
    export { MEMBERS_MS };
}
export default _default;
export type AgentLink = import("./link.js").AgentLink;
export type FoundAgent = {
    sub: string;
    id: string;
    name: string;
};
/**
 * Lo que se guarda entre una búsqueda y la siguiente: la conexión con la que se pregunta quién
 * contesta, y cuándo se le pidió el acta a la bóveda por última vez.
 */
export type DiscoverState = {
    probe: import("@dotrino/proxy-client").WebSocketProxyClient | null;
    askedVaultAt?: number;
};
import { RemoteAgentClient } from './client.js';
