/**
 * discover.js — autodescubrimiento de agentes vinculados al vault (lado cliente).
 *
 * Tus agentes = los dispositivos enrolados en TU vault (`vault.devices` trae la
 * pubkey `sub` de cada uno = su dirección en el proxy). Sin pegar nada: filtrás por
 * label y abrís una sesión con el que quieras.
 *
 * Si pasás `label` (p. ej. `'ia-agent'`), lista solo los dispositivos con ESE label
 * exacto. Si NO pasás `label`, mantiene el comportamiento legacy de terminal: lista
 * cualquier dispositivo que tenga un label y no sea `'cli'` (los navegadores
 * enrolados quedan con label `'cli'` y no atienden agentes).
 */

/**
 * @param {object} id   instancia de Identity (del vault) ya conectada.
 * @param {string} [label]  filtrar por label exacto (p. ej. 'ia-agent'). Omitir = todos los no-cli.
 * @returns {Promise<Array<{sub:string,label:string,deviceId:string,exp?:number}>>}
 *   dedup por pubkey (renovaciones/re-emparejes → el cert más nuevo).
 */
export async function listAgentsByLabel (id, label) {
  const { devices } = await id.listVaultDevices()
  const mine = id.me?.publickey
  const now = Date.now()
  const bySub = new Map()
  for (const d of devices || []) {
    if (!d.sub || d.sub === mine || (d.exp && d.exp <= now)) continue
    if (label ? d.label !== label : (!d.label || d.label === 'cli')) continue
    if (!bySub.has(d.sub) || (d.exp || 0) > (bySub.get(d.sub).exp || 0)) bySub.set(d.sub, d)
  }
  return [...bySub.values()]
}

export default { listAgentsByLabel }
