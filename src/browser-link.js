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
export async function linkFromIdentity (id) {
  if (!id) throw Object.assign(new Error('linkFromIdentity: no identity'), { code: 'no-identity' })
  const status = await id.vaultStatus()
  if (!status?.paired) return { paired: false, id }
  // Cert vencido = la bóveda rechazará todo: no emparejado, y se dice para volver a enlazar.
  if (status.exp && status.exp <= Date.now()) return { paired: false, expired: true, exp: status.exp, id }
  const v = await id.getVaultCert()
  if (!v?.cert) return { paired: false, id }
  return {
    paired: true,
    id,
    cert: v.cert,
    iss: status.master,
    proxy: status.proxy || 'wss://proxy.dotrino.com',
    deviceId: status.deviceId,
    scope: status.scope || []
  }
}

export default { linkFromIdentity }
