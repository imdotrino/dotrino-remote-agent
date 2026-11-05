/**
 * El enlace de un NAVEGADOR a su bóveda, sacado del pilar de identidad (iframe
 * id.dotrino.com): es lo que necesita `RemoteAgentClient` para hablar con un agente.
 * Antes lo armaba cada app por su cuenta (terminal, ia, eco, content-client).
 *
 * Sin repliegues: si la identidad no contesta, lanza. «No pude preguntar» no es «no
 * estás emparejado», y quien llama tiene que poder distinguirlo.
 *
 * @param {any} id  una instancia de `Identity` (`@dotrino/identity`)
 * @returns {Promise<{ paired: false, id: any, expired?: boolean, exp?: number }
 *   | { paired: true, id: any, cert: any, iss: string, proxy: string, deviceId: string, scope: string[] }>}
 */
export function linkFromIdentity(id: any): Promise<{
    paired: false;
    id: any;
    expired?: boolean;
    exp?: number;
} | {
    paired: true;
    id: any;
    cert: any;
    iss: string;
    proxy: string;
    deviceId: string;
    scope: string[];
}>;
declare namespace _default {
    export { linkFromIdentity };
}
export default _default;
