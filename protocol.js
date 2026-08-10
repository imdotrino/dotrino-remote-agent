/**
 * protocol.js — constantes del protocolo de transporte de `@dotrino/remote-agent`.
 *
 * El protocolo tiene dos capas:
 *  1. Envelope de transporte (visible al relay/proxy): `{ type, sid, env?, ... }`.
 *     Usa los tipos `ra.*` de aquí abajo. El proxy solo ve el `type` + ciphertext.
 *  2. Payload de dominio (dentro de `env`, cifrado AES-256-GCM): un objeto
 *     arbitrario definido por CADA app (terminal envía `{type:'cmd',...}`,
 *     ia envía `{type:'msg',...}`). El paquete no impone su forma.
 *
 * El handshake (HS/ACK) y la liveness (PING/PONG) son comunes; el despacho de
 * payloads de dominio viaja por el tipo `DATA` genérico.
 */

export const HS = 'ra.hs'
export const ACK = 'ra.hs.ack'
export const DATA = 'ra.data'        // payload de dominio cifrado (cualquier dirección)
export const PING = 'ra.ping'
export const PONG = 'ra.pong'
export const ERROR = 'ra.error'

/** Mensajes del vault (refresco de dispositivos / revocación / renovación). */
export const VMSG = {
  DEVICES: 'vault.devices',
  DEVICES_RESULT: 'vault.devices.result',
  REVOKED: 'vault.revoked',
  RENEW: 'vault.renew',
  RENEWED: 'vault.renewed',
  ERROR: 'vault.error'
}

/** Scope del cert de dispositivo que autoriza a hablar con el agente. */
export const SIGN_SCOPE = 'vault:sign'

/** Vigencia de una sesión inactiva y refresco de la lista de revocados. */
export const SESSION_TTL_MS = 30 * 60 * 1000
export const REVOKE_REFRESH_MS = 5 * 60 * 1000

/**
 * RENOVACIÓN del cert de esta máquina. El cert dura 30 días; se pide uno fresco
 * cuando le quedan menos de 7. El margen es amplio a propósito: un agente puede
 * pasar días con el proxy caído o la bóveda apagada, y debe tener muchas ventanas
 * de reintento antes de que el cert venza. Un cert VENCIDO ya no se renueva —ahí
 * toca re-emparejar a mano—, que es exactamente lo que esto viene a evitar.
 */
export const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000
