/**
 * Las formas de datos que aparecen en los tipos publicados de @dotrino/remote-agent. Solo
 * tipos: no hay código aquí. `npm run types` lo copia a `types/src/` junto a los generados.
 */

/**
 * Lo que un cliente del ecosistema usa de una identidad: el `Identity` del navegador o la que
 * arma `identityFromLink` con la llave de un aparato.
 */
export interface AgentIdentity {
  me: { publickey: string, nickname?: string } | null
  signData (data: object): Promise<{ signature: string, publickey?: string, profileId?: string | null, chain?: unknown[] | null } & Record<string, unknown>>
  listVaultDevices (): Promise<{ acta?: DotrinoActa | null } & Record<string, unknown>>
  profileActa? (): Promise<{ acta: DotrinoActa } | null>
  getVaultCert? (): Promise<{ cert: unknown }>
  vaultStatus? (): Promise<Record<string, unknown>>
}

/** Un acta (la lista de miembros de una cuenta). Llega de la red: se comprueba antes de usarla. */
export interface DotrinoActa {
  seq: number
  profileId: string
  members?: Array<{ pub: string, caps?: string[], label?: string, cn?: string } & Record<string, unknown>>
  [k: string]: unknown
}
