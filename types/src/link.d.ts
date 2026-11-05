/** @typedef {import('./shapes.js').AgentIdentity} AgentIdentity */
/** @typedef {import('./shapes.js').DotrinoActa} DotrinoActa */
/**
 * El papel de un aparato: lo firma la bóveda. `seq` es el del acta con que se emitió; `exp`
 * solo lo lleva el modelo viejo (por fecha).
 * @typedef {{ seq?: number, exp?: number } & Record<string, unknown>} AgentCert
 */
/**
 * El enlace de esta máquina con su cuenta (`link.json`). Con bóveda: `device`, `enc`, `cert`,
 * `iss`, `proxy`. Propio (`self: true`): `device`, `enc` y su génesis en `sealerChain`.
 * @typedef {object} AgentLink
 * @property {{ publickey: string, privateJwk: JsonWebKey }} device
 * @property {{ publickey?: string, privateJwk?: JsonWebKey } & Record<string, unknown>} [enc]
 * @property {AgentCert} [cert]
 * @property {string} [iss]          la bóveda con que se enroló
 * @property {string} [proxy]
 * @property {string} [label]
 * @property {string} [ns]
 * @property {number} [at]
 * @property {boolean} [self]
 * @property {DotrinoActa[]} [sealerChain]
 * @property {DotrinoActa} [acta]     el acta de confianza (solo si `actaTrusted`)
 * @property {boolean} [actaTrusted]
 * @property {number} [actaSeq]      la `seq` del acta más nueva que se ha visto
 * @property {string[]} [blocked]   aparatos bloqueados por la bóveda (pubkeys)
 */
/** @param {string} [name] @returns {string} */
export function dataDir(name?: string): string;
/**
 * Lee el enlace persistido, o `null` si NO EXISTE. Un enlace en claro (anterior a 0.30.0) se
 * lee y se reescribe cifrado en el acto, comprobando antes que se vuelve a leer igual.
 *
 * Si existe y no se puede leer —otro equipo, la máquina cambió, el archivo está roto— LANZA
 * (`link-unreadable`). Devolver `null` diría «no hay enlace», y quien lo llama crearía otro
 * encima del que ya era el aparato: la identidad se perdería en silencio.
 */
export function loadLink(dir?: string): AgentLink | null;
/** Persiste el enlace, cifrado (0600). Exportada porque la RENOVACIÓN del cert lo reescribe. */
/** @param {string} dir @param {AgentLink} link */
export function saveLink(dir: string, link: AgentLink): void;
/**
 * Parsea una invitación de la bóveda a objeto. Acepta TODAS las formas que imprime
 * `dotrino-vault pair` (URL del QR, código compacto, JSON, base64url): es el mismo
 * `parseInvite` del ecosistema. `enroll` ya lo hace solo; esto es para quien quiera
 * mirar la invitación antes (qué bóveda, qué proxy) sin enrolar.
 * @param {string} text
 */
export function parseQr(text: string): Promise<{
    sn?: string;
    iss?: string;
    conn?: unknown;
} & Record<string, unknown>>;
/** base64url → utf8 (lo usan los tests y algún QR viejo). */
/** @param {string} s @returns {string} */
export function b64urlDecode(s: string): string;
/**
 * Enrola ESTA máquina contra la bóveda y persiste el enlace
 * `{ device, enc, cert, iss, proxy, label, ns?, at }`.
 *
 * El enrolamiento en sí es el del ecosistema —`enrollWithVault` de `@dotrino/vault`—
 * y no se duplica aquí: entiende cualquier invitación, crea las DOS llaves del aparato
 * (firma y **cifrado**: sin la segunda la bóveda no puede sellarle secretos) y
 * verifica el cert. Este módulo solo decide dónde vive.
 *
 * Lo que puede hacer el aparato lo decide la invitación (`dotrino-vault pair --scope …`):
 * no hay tipos de agente, hay permisos. Un bot que publica y lee su cajón se empareja
 * con `pair --service <ns> --scope sign`; pásale `ns` para que el enlace lo recuerde y
 * exija ese permiso en el cert.
 *
 * @param {object} args
 * @param {object|string} args.qr     La invitación, en cualquiera de sus formas.
 * @param {string} [args.label='remote-agent']  label del dispositivo (lo filtra el cliente).
 * @param {string} [args.dir=dataDir()]         dónde persistir el enlace.
 * @param {string | null} [args.ns]             cajón de secretos que lee este agente (si lo hay).
 * @param {(c:{deviceId:string,code:string})=>void} [args.onChallenge]  mostrar el CÓDIGO para
 *        que un humano lo TIPEE en la bóveda al aprobar (el código NO viaja de aquí).
 * @param {number} [args.timeoutMs=180000]
 * @returns {Promise<AgentLink>}
 */
export function enroll({ qr, label, dir, ns, onChallenge, timeoutMs }?: {
    qr: object | string;
    label?: string | undefined;
    dir?: string | undefined;
    ns?: string | null | undefined;
    onChallenge?: ((c: {
        deviceId: string;
        code: string;
    }) => void) | undefined;
    timeoutMs?: number | undefined;
}): Promise<AgentLink>;
/**
 * UNA IDENTIDAD PROPIA, SIN BÓVEDA. El aparato cumple el rol cuando no hay pieza dedicada:
 * crea sus llaves (firma y cifrado) y un acta de génesis autofirmada donde él es el único
 * miembro. Es una cuenta de un solo aparato, igual que «este dispositivo es bóveda» en el
 * navegador: `verifySignedFor` la acepta sin saber nada más, porque la raíz de toda cuenta
 * es un acta autofirmada.
 *
 * El enlace queda `{ device, enc, label, self: true, sealerChain: [génesis], at }`, sin
 * `cert` ni `iss`.
 *
 * EMPAREJARLO DESPUÉS CAMBIA LA LLAVE, a propósito (dueño, 2026-11-04): `enroll` crea otra y
 * sobrescribe este enlace. Una llave está en UNA sola cuenta. Si entrara a una bóveda con la
 * misma, seguiría siendo la raíz de su génesis y podría entrar igual a otras bóvedas.
 *
 * @param {{ label?: string, dir?: string }} [args]
 * @returns {Promise<AgentLink>}
 */
export function selfLink({ label, dir }?: {
    label?: string;
    dir?: string;
}): Promise<AgentLink>;
/**
 * La IDENTIDAD de un agente a partir de su enlace: lo que un cliente del ecosistema
 * espera como `link.id` (`RemoteAgentClient`, `ContentClient`, `listAgentsByLabel`) —
 * `me.publickey`, `signData`, `listVaultDevices`, `getVaultCert`, `vaultStatus`— pero
 * firmando con la llave del aparato en vez de con el pilar del navegador. Así un agente
 * Node puede ser CLIENTE de otro agente (un bot que guarda en el node de contenido)
 * con el mismo código que usa una app.
 *
 * @param {AgentLink} link  el enlace (`loadLink(dir)`).
 * @param {{ dir?: string }} [opts]  dir para los globals de Node (localStorage del proxy-client).
 * @returns {AgentIdentity}
 */
export function identityFromLink(link: AgentLink, { dir }?: {
    dir?: string;
}): AgentIdentity;
/**
 * El acta que `listVaultDevices` puede dar por buena. Exportada para las pruebas.
 * @param {AgentLink} link
 * @param {DotrinoActa | null | undefined} candidate  la que llegó por la red
 * @param {string} me
 * @returns {Promise<DotrinoActa | null>}
 */
export function checkedActa(link: AgentLink, candidate: DotrinoActa | null | undefined, me: string): Promise<DotrinoActa | null>;
/**
 * POR QUÉ TOCA PEDIR PAPEL NUEVO, o `null` si no toca. Es la única regla de renovación:
 * la usan `renewLink` (agentes que corren una vez) y el tic de `startRemoteAgent`.
 *   · `'legacy'`: el papel es del MODELO VIEJO (lleva `exp` y no `seq`). Se cambia sí o sí:
 *     se acepta por el repliegue de migración, pero muere en su fecha y con él la máquina.
 *   · `'behind'`: el acta que hemos visto va por delante del papel (el dueño cambió permisos).
 * Nunca por calendario: el papel no vence.
 *
 * @param {AgentLink} link
 * @returns {'legacy'|'behind'|null}
 */
export function renewalReason(link: AgentLink): "legacy" | "behind" | null;
/**
 * GUARDA un papel renovado (ya comprobado por quien lo pidió) y lo persiste. SE GUARDA ANTES
 * DE DAR NADA POR BUENO: emitir un papel RETIRA el anterior, así que si esto no se persiste la
 * máquina se queda usando uno revocado y fuera para siempre.
 *
 * El acta que viaja con el papel se adopta SOLO si se puede comprobar (`record.js`): es la que
 * decide quién abre sesión con este agente. El papel sí se guarda siempre.
 */
/** @param {{ dir: string, link: AgentLink, cert: AgentCert, acta: DotrinoActa }} o */
export function storeRenewedCert({ dir, link, cert, acta }: {
    dir: string;
    link: AgentLink;
    cert: AgentCert;
    acta: DotrinoActa;
}): Promise<void>;
/**
 * RENUEVA el cert del enlace si vence pronto y lo persiste. Es lo que hace el agente
 * de larga duración en cada tic (`startRemoteAgent`), sacado aquí para los agentes que
 * corren UNA vez (un bot por cron): sin esto su cert muere a los 30 días y hay que
 * re-emparejar una máquina que nunca dejó de ser tuya.
 *
 * El cert nuevo se VERIFICA antes de guardarlo (misma maestra, misma llave, más vida).
 * Un cert ya vencido no se renueva: ahí toca re-emparejar. No lanza: devuelve qué pasó.
 *
 * @param {AgentLink} link   el enlace (se muta con el cert nuevo).
 * @param {{ dir?: string, force?: boolean }} [opts]
 * @returns {Promise<{ renewed: boolean, seq?: number | null, reason?: string }>}  `seq`: la del papel que queda
 */
export function renewLink(link: AgentLink, { dir, force }?: {
    dir?: string;
    force?: boolean;
}): Promise<{
    renewed: boolean;
    seq?: number | null;
    reason?: string;
}>;
/**
 * TRAE LA CADENA DE SELLADORES de la cuenta y la guarda en el enlace: con ella `signData`
 * firma a nombre de la cuenta de forma que `verifySignedFor` lo compruebe desde el génesis.
 * Se comprueba ANTES de guardarla (`verifySealerChain`): una cadena que no encadena o que es
 * de otra cuenta no entra. Un agente que firma de cara a terceros la pide al arrancar y la
 * refresca de vez en cuando. No lanza: devuelve qué pasó.
 *
 * @param {AgentLink} link
 * @param {{ dir?: string }} [opts]
 * @returns {Promise<{ ok: boolean, seq?: number, reason?: string, self?: boolean }>}
 */
export function refreshChain(link: AgentLink, { dir }?: {
    dir?: string;
}): Promise<{
    ok: boolean;
    seq?: number;
    reason?: string;
    self?: boolean;
}>;
/**
 * El enlace como lo esperan `ContentClient.connect({ link })` y `RemoteAgentClient`.
 * @param {AgentLink} link
 * @param {{ dir?: string }} [opts]
 */
export function clientLink(link: AgentLink, opts?: {
    dir?: string;
}): {
    id: import("./shapes.js").AgentIdentity;
    cert: AgentCert | undefined;
    iss: string | undefined;
    proxy: string;
};
export function isSelfLink(link: AgentLink | null | undefined): boolean;
export { RENEW_BEFORE_MS };
declare namespace _default {
    export { dataDir };
    export { loadLink };
    export { saveLink };
    export { parseQr };
    export { enroll };
    export { selfLink };
    export { isSelfLink };
    export { identityFromLink };
    export { clientLink };
    export { renewLink };
    export { renewalReason };
    export { storeRenewedCert };
    export { refreshChain };
}
export default _default;
export type AgentIdentity = import("./shapes.js").AgentIdentity;
export type DotrinoActa = import("./shapes.js").DotrinoActa;
/**
 * El papel de un aparato: lo firma la bóveda. `seq` es el del acta con que se emitió; `exp`
 * solo lo lleva el modelo viejo (por fecha).
 */
export type AgentCert = {
    seq?: number;
    exp?: number;
} & Record<string, unknown>;
/**
 * El enlace de esta máquina con su cuenta (`link.json`). Con bóveda: `device`, `enc`, `cert`,
 * `iss`, `proxy`. Propio (`self: true`): `device`, `enc` y su génesis en `sealerChain`.
 */
export type AgentLink = {
    device: {
        publickey: string;
        privateJwk: JsonWebKey;
    };
    enc?: ({
        publickey?: string;
        privateJwk?: JsonWebKey;
    } & Record<string, unknown>) | undefined;
    cert?: AgentCert | undefined;
    /**
     * la bóveda con que se enroló
     */
    iss?: string | undefined;
    proxy?: string | undefined;
    label?: string | undefined;
    ns?: string | undefined;
    at?: number | undefined;
    self?: boolean | undefined;
    sealerChain?: import("./shapes.js").DotrinoActa[] | undefined;
    /**
     * el acta de confianza (solo si `actaTrusted`)
     */
    acta?: import("./shapes.js").DotrinoActa | undefined;
    actaTrusted?: boolean | undefined;
    /**
     * la `seq` del acta más nueva que se ha visto
     */
    actaSeq?: number | undefined;
    /**
     * aparatos bloqueados por la bóveda (pubkeys)
     */
    blocked?: string[] | undefined;
};
import { RENEW_BEFORE_MS } from '../protocol.js';
