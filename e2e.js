/**
 * e2e.js — el canal cifrado entre el dispositivo enlazado y el agente.
 *
 * Vive en `@dotrino/identity/channel` (identity ≥ 0.120.0): aquí solo se reexporta para que
 * quien importaba `makeEphemeral`/`deriveKey`/`seal`/`open` de este paquete siga igual. El
 * cable no cambió: mismo HKDF, mismo `info`, mismos sobres.
 */
export { makeEphemeral, deriveKey, seal, open, b64 } from '@dotrino/identity/channel'
