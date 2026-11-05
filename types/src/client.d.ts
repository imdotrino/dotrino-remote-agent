/** @typedef {import('./shapes.js').AgentIdentity} AgentIdentity */
/** @typedef {import('./shapes.js').DotrinoActa} DotrinoActa */
/**
 * El enlace con que se habla a un agente: el de una pestaña (identidad del vault) o el de
 * otro agente (`clientLink`).
 * @typedef {object} ClientLink
 * @property {AgentIdentity} id
 * @property {unknown} cert
 * @property {string} [iss]
 * @property {string} [proxy]
 * @property {string} [mode]                       'self': el dispositivo es su propio vault
 * @property {DotrinoActa} [acta]                   un acta ya comprobada, si la trae
 * @property {() => Promise<unknown>} [getSelfCert] modo self: refresca el self-cert
 */
/** Un ack del agente tal como llega (se comprueba en `_judgeAck`). */
/** @typedef {{ type: string, ack: any, signature: string, cert: unknown, sid: string, from?: string }} AgentAck */
export class RemoteAgentClient {
    /**
     * @param {ClientLink} link
     *   enlace del vault (modo vault) o de @dotrino/vault (modo self: el dispositivo
     *   es su propio vault; `cert` es el self-cert `P ← P` e `iss` es la propia P).
     * @param {object} [opts]  `agentPubkey` es obligatoria: `connect` la comprueba.
     * @param {string} [opts.agentPubkey] dirección (pubkey) del agente destino.
     * @param {string} [opts.proxyUrl]  override del proxy del enlace.
     * @param {(() => DotrinoActa | null) | null} [opts.trustedActa] un acta ya COMPROBADA y que alguien mantiene
     *   al día (un agente de Node: la de su enlace, que refresca cada 5 min y con los avisos de la
     *   bóveda). Con ella el saludo no espera a la bóveda; si no pasa, se le pregunta y se juzga
     *   otra vez. Sin ella, la bóveda en cada saludo, como siempre.
     */
    constructor(link: ClientLink, { agentPubkey, proxyUrl, trustedActa }?: {
        agentPubkey?: string | undefined;
        proxyUrl?: string | undefined;
        trustedActa?: (() => DotrinoActa | null) | null | undefined;
    });
    link: ClientLink;
    trustedActa: (() => DotrinoActa | null) | null;
    agentPubkey: string | undefined;
    proxyUrl: string;
    /** @type {import('@dotrino/proxy-client').WebSocketProxyClient | null} */
    client: import("@dotrino/proxy-client").WebSocketProxyClient | null;
    /** @type {CryptoKey | null} */
    key: CryptoKey | null;
    /** @type {string | null} */
    sid: string | null;
    /** @type {Record<string, Array<(...args: any[]) => void>>} */
    _h: Record<string, Array<(...args: any[]) => void>>;
    /** @type {Promise<void> | null} */
    _resuming: Promise<void> | null;
    /** @type {Promise<void> | undefined} */
    _in: Promise<void> | undefined;
    /** @type {Promise<void> | undefined} */
    _out: Promise<void> | undefined;
    /** @type {unknown} */
    actaCacheError: unknown;
    /** @type {string | null} */
    agentToken: string | null;
    /** @type {Set<string>} */
    _directPeers: Set<string>;
    /**
     * Suscribe a eventos. Devuelve un `off()` para desuscribir. Eventos: message, error, resumed.
     * @param {'message' | 'error' | 'resumed'} ev
     * @param {(...args: any[]) => void} cb
     * @returns {() => void}
     */
    on(ev: "message" | "error" | "resumed", cb: (...args: any[]) => void): () => void;
    /** @param {string} ev @param {...unknown} args */
    _emit(ev: string, ...args: unknown[]): void;
    /**
     * El acta con la que se juzga al agente. Se pide EN CADA SALUDO, no una vez por cliente:
     * una pestaña vive días, y volver a saludar a una máquina que el dueño quitó entretanto
     * tiene que fallar. `listVaultDevices` devuelve el acta ya COMPROBADA (la adoptada, no la
     * que llegó por la red: identity ≥ 0.126.2, y `identityFromLink` en Node).
     *
     * Si la bóveda no contesta vale la que este aparato ya adoptó (`profileActa`): está
     * comprobada, igual que la que guarda el agente. Es lo mismo que hace `listAgentsByLabel`.
     * Si no hay ninguna, `null` y se corta con `no-record`: sin acta no hay con qué decidir, y
     * no decidir es que no.
     */
    /** @returns {Promise<DotrinoActa | null>} */
    _acta(): Promise<DotrinoActa | null>;
    _identify(): Promise<void>;
    connect(): Promise<this>;
    /**
     * Un error del agente. Si es que ya no conoce NUESTRA sesión (se reinició: las sesiones
     * viven en su memoria), se vuelve a saludar solo y se avisa con `resumed`; lo que la app
     * tenía abierto allí lo decide la app. Cualquier otro error, o no poder volver a saludar,
     * sale por `error`. Un `unknown-session` de un `sid` que ya no es el nuestro (llegó tarde,
     * de antes de volver a saludar) no dice nada nuevo y se ignora.
     */
    /** @param {{ code?: string, error?: string, reason?: string, sid?: string }} p */
    _onAgentError(p: {
        code?: string;
        error?: string;
        reason?: string;
        sid?: string;
    }): void;
    /** Vuelve a saludar, una sola vez aunque lleguen varios errores seguidos. */
    /** @returns {Promise<void>} */
    _resume(): Promise<void>;
    /** El saludo: abre una sesión con el agente y deja `sid` y `key`. */
    _handshake(): Promise<void>;
    /**
     * Comprueba el ack y deja `sid` y `key`.
     * @param {AgentAck} res
     * @param {{ privateKey: CryptoKey, pub: string }} eph
     */
    _checkAck(res: AgentAck, eph: {
        privateKey: CryptoKey;
        pub: string;
    }): Promise<void>;
    /**
     * La más nueva de la caché del proxio que ENCADENE desde `trusted` (`canAdopt`), o `null`.
     * El proxio no es de fiar: lo que no encadena se ignora. Si no se pudo preguntar, el motivo
     * queda en `actaCacheError` y se sigue con la bóveda, que es quien manda.
     */
    /** @param {DotrinoActa} trusted @returns {Promise<DotrinoActa | null>} */
    _actaFromProxy(trusted: DotrinoActa): Promise<DotrinoActa | null>;
    /**
     * Juzga el ack con `acta` y, si pasa, deja `sid` y `key`.
     * @param {AgentAck} res
     * @param {{ privateKey: CryptoKey, pub: string }} eph
     * @param {DotrinoActa | null} acta
     */
    _judgeAck(res: AgentAck, eph: {
        privateKey: CryptoKey;
        pub: string;
    }, acta: DotrinoActa | null): Promise<void>;
    /**
     * Envía un payload de dominio cifrado al agente (si se está volviendo a saludar, después).
     * @param {unknown} payload
     * @returns {Promise<void>}
     */
    send(payload: unknown): Promise<void>;
    /**
     * Sonda de presencia (liveness) sin abrir sesión. Devuelve true si responde.
     * @param {{ timeoutMs?: number }} [o]
     * @returns {Promise<boolean>}
     */
    ping({ timeoutMs }?: {
        timeoutMs?: number;
    }): Promise<boolean>;
    close(): Promise<void>;
    /** El transporte, que existe desde `connect`. Usarlo antes es un fallo de quien llama. */
    _client(): import("@dotrino/proxy-client").WebSocketProxyClient;
}
declare namespace _default {
    export { RemoteAgentClient };
}
export default _default;
export type AgentIdentity = import("./shapes.js").AgentIdentity;
export type DotrinoActa = import("./shapes.js").DotrinoActa;
/**
 * El enlace con que se habla a un agente: el de una pestaña (identidad del vault) o el de
 * otro agente (`clientLink`).
 */
export type ClientLink = {
    id: AgentIdentity;
    cert: unknown;
    iss?: string | undefined;
    proxy?: string | undefined;
    /**
     * 'self': el dispositivo es su propio vault
     */
    mode?: string | undefined;
    /**
     * un acta ya comprobada, si la trae
     */
    acta?: import("./shapes.js").DotrinoActa | undefined;
    /**
     * modo self: refresca el self-cert
     */
    getSelfCert?: (() => Promise<unknown>) | undefined;
};
export type AgentAck = {
    type: string;
    ack: any;
    signature: string;
    cert: unknown;
    sid: string;
    from?: string;
};
