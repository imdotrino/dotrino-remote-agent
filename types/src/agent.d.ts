/**
 * Arranca el agente. Devuelve `{ machine, machineId, master, client, reportIncident, isBlocked, checkCap, record, close }`.
 *
 * @param {object} [opts]
 * @param {string} [opts.label]       qué agente es (`terminal-agent`, `ia-agent`…): lo contesta el pong
 *   para que las apps lo encuentren (`probeAgents`). El nombre del acta es del dueño.
 * @param {string} [opts.proxyUrl]    default wss://proxy.dotrino.com.
 * @param {string} [opts.dir]         dir del enlace (default dataDir()).
 * @param {import('./link.js').AgentLink | null} [opts.link]  enlace ya cargado (override de dir).
 * @param {(session:AgentSession)=>void} [opts.onSession]  cada handshake exitoso abre una sesión.
 * @param {()=>void} [opts.onRevoked] se llamó al auto-borrarse por revocación.
 * @param {(o: { machine: string, machineId: string, master: string }) => void} [opts.onReady]   agente listo y escuchando.
 * @param {boolean} [opts.quiet]      sin logs.
 * @param {number} [opts.sessionGoneMs]  cuánto se espera a un cliente cuya conexión se fue (`SESSION_GONE_MS`).
 * @param {number} [opts.sessionTtlMs]   cuánto dura una sesión sin mensajes (`SESSION_TTL_MS`, 30 min).
 * @param {number} [opts.netLogMs]    cada cuánto van al log las estadísticas de red (5 min).
 * @param {import('@dotrino/proxy-client').WebSocketProxyClient} [opts.client]  transporte ya conectado (SOLO pruebas).
 * @param {string} [opts.product]     qué producto es (`accounts`, `terminal-agent`…), para el anuncio a la bóveda.
 * @param {string} [opts.version]     su versión. Sin `product`/`version` se anuncia como `remote-agent`.
 * @param {string[]} [opts.needs]     los permisos del acta que necesita, además de `sign`, que lo
 *   añade este pilar: sin él no se abre ninguna sesión (`@dotrino/compat` ≥ 0.5.0).
 *
 * Devuelve además el **`client`** (el `WebSocketProxyClient` ya conectado e
 * identificado bajo la pubkey de esta máquina). Se expone a propósito: un agente
 * que necesite algo más del transporte —anunciarse en un canal, por ejemplo— debe
 * reusar ESTA conexión y no abrir otra. Dos conexiones del mismo aparato al proxy
 * son dos identidades de transporte, dos `identify` y dos colas: exactamente el
 * lío que este middleware existe para evitar.
 */
export function startRemoteAgent(opts?: {
    label?: string | undefined;
    proxyUrl?: string | undefined;
    dir?: string | undefined;
    link?: import("./link.js").AgentLink | null | undefined;
    onSession?: ((session: AgentSession) => void) | undefined;
    onRevoked?: (() => void) | undefined;
    onReady?: ((o: {
        machine: string;
        machineId: string;
        master: string;
    }) => void) | undefined;
    quiet?: boolean | undefined;
    sessionGoneMs?: number | undefined;
    sessionTtlMs?: number | undefined;
    netLogMs?: number | undefined;
    client?: import("@dotrino/proxy-client").WebSocketProxyClient | undefined;
    product?: string | undefined;
    version?: string | undefined;
    needs?: string[] | undefined;
}): Promise<{
    machine: string;
    machineId: string;
    master: string;
    client: import("@dotrino/proxy-client").WebSocketProxyClient;
    reportIncident: ({ kind, about, tries }: {
        kind: string;
        about: string;
        tries?: number | null;
    }) => Promise<{
        id: any;
        approvers: any;
        blocked: boolean;
    }>;
    isBlocked: (pub: string) => boolean;
    checkCap: (pub: string, cap: string) => Promise<{
        ok: true;
        seq: number;
    } | {
        ok: false;
        code: "no-record" | "not-in-record" | "missing-cap";
    }>;
    record: () => DotrinoActa | null;
    close: () => void;
}>;
/** Sesión cifrada con un dispositivo cliente. La app recibe esto en `onSession`. */
export class AgentSession {
    /**
     * @param {{ sid: string, key: CryptoKey, from: string, device: string,
     *   send: (to: string, obj: object) => void, isDirect?: ((token: string) => boolean) | null }} o
     */
    constructor({ sid, key, from, device, send, isDirect }: {
        sid: string;
        key: CryptoKey;
        from: string;
        device: string;
        send: (to: string, obj: object) => void;
        isDirect?: ((token: string) => boolean) | null;
    });
    sid: string;
    key: CryptoKey;
    from: string;
    device: string;
    _send: (to: string, obj: object) => void;
    _isDirect: ((token: string) => boolean) | null;
    /** @type {{ message: Array<(msg: any) => void>, close: Array<() => void> }} */
    _h: {
        message: Array<(msg: any) => void>;
        close: Array<() => void>;
    };
    _closed: boolean;
    /** @type {Promise<void> | undefined} */
    _out: Promise<void> | undefined;
    /** @type {Promise<void> | undefined} */
    _in: Promise<void> | undefined;
    /** Cuándo caduca sin mensajes (ms epoch). Lo pone el agente. */
    _exp: number;
    /**
     * El nonce del papel del cliente, para cortarla si se revoca.
     * @type {string | null}
     */
    _certNonce: string | null;
    /**
     * El cliente se desconectó: se le espera hasta que salte.
     * @type {ReturnType<typeof setTimeout> | null}
     */
    _gone: ReturnType<typeof setTimeout> | null;
    /**
     * Envía un payload de dominio cifrado al cliente.
     * @param {unknown} payload
     * @returns {Promise<void>}
     */
    send(payload: unknown): Promise<void>;
    /**
     * ¿VA YA POR EL CANAL DIRECTO (WebRTC) lo que se le mande a este cliente? Mientras sea
     * `false`, cada `send` da la vuelta por el proxio. Sirve para que la app decida qué manda
     * YA y qué puede esperar: nunca para dejar de mandar (subir de escalón no bloquea).
     */
    direct(): boolean;
    /**
     * Espera a que abra el canal directo, como mucho `ms`. Resuelve `true` si abrió y `false`
     * si se acabó el plazo o la sesión se cerró — en los dos casos se sigue, por donde haya.
     */
    /** @param {number} [ms] @returns {Promise<boolean>} */
    whenDirect(ms?: number): Promise<boolean>;
    /**
     * @param {'message' | 'close'} ev  `message` recibe lo que mandó el cliente, ya descifrado
     * @param {(msg?: any) => void} cb
     * @returns {this}
     */
    on(ev: "message" | "close", cb: (msg?: any) => void): this;
    /** Lo que llega se entrega en el orden en que llegó, tarde lo que tarde en descifrarse cada uno. */
    /** @param {{ iv: string, ct: string }} env */
    _ingest(env: {
        iv: string;
        ct: string;
    }): Promise<void>;
    close(): void;
}
declare namespace _default {
    export { startRemoteAgent };
}
export default _default;
export type DotrinoActa = import("./shapes.js").DotrinoActa;
