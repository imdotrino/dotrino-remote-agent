// Tipos de los subpaths de pilares que usa este paquete y que se publican en JS sin .d.ts.
// Solo lo que se usa aquí, con la forma que documenta cada pilar en su JSDoc. Si un pilar
// empieza a publicar sus tipos, la entrada de aquí se borra.

/**
 * Lo que un cliente del ecosistema usa de una identidad: el `Identity` del navegador o la que
 * arma `identityFromLink` con la llave de un aparato.
 */
interface AgentIdentity {
  me: { publickey: string, nickname?: string } | null
  signData (data: object): Promise<{ signature: string, publickey?: string, profileId?: string | null, chain?: unknown[] | null } & Record<string, unknown>>
  listVaultDevices (): Promise<{ acta?: DotrinoActa | null } & Record<string, unknown>>
  profileActa? (): Promise<{ acta: DotrinoActa } | null>
  getVaultCert? (): Promise<{ cert: unknown }>
  vaultStatus? (): Promise<Record<string, unknown>>
}

/** Un acta (la lista de miembros de una cuenta). Llega de la red: se comprueba antes de usarla. */
interface DotrinoActa {
  seq: number
  profileId: string
  members?: Array<{ pub: string, caps?: string[], label?: string, cn?: string } & Record<string, unknown>>
  [k: string]: unknown
}

declare module '@dotrino/identity/acta' {
  export function canAdopt (o: { candidate: DotrinoActa, current: DotrinoActa | null }): Promise<{ adopt: boolean, reason: string }>
  export function verifyActa (o: { acta: unknown, expectedProfileId?: string | null }): Promise<{ ok: true } | { ok: false, reason: string }>
  export function samePubkey (a: unknown, b: unknown): boolean
  export function sealersOf (acta: DotrinoActa | null | undefined, renounces?: string[]): string[]
  export function memberCan (acta: DotrinoActa | null | undefined, pub: string, cap: string, extraRenounces?: string[]): boolean
  export function checkVaultReply (o: { acta: unknown, cert: unknown, vault: string, sub?: string, scope?: string | null, justSealed?: boolean }):
    Promise<{ ok: true } | { ok: false, reason: string }>
  export function verifySealerChain (chain: unknown[], o?: { expectedProfileId?: string | null }):
    Promise<{ ok: true, profileId: string, seq: number, sealers: string[] } | { ok: false, reason: string }>
  export function genesisActa (o: { pub: string, encPub?: string | null, sealPub?: string | null, label?: string, chainUrl?: string | null, now?: number }): DotrinoActa
  export function sealActa (o: { acta: DotrinoActa, privateKey?: CryptoKey, privateJwk?: JsonWebKey }): Promise<DotrinoActa>
}

declare module '@dotrino/identity/capabilities' {
  export function verifyChain (o: {
    data: unknown, signature: string, cert: unknown, expectedScope?: string, actaSeq?: number | null,
    sealers?: string[] | null, revoked?: unknown
  }): Promise<{ ok: boolean, reason?: string, issuer?: string, device?: string }>
  export function signWithDevice (o: { privateJwk?: JsonWebKey, privateKey?: CryptoKey, publickey?: string, data: unknown, sign?: unknown }):
    Promise<{ signature: string, publickey?: string } & Record<string, unknown>>
  export function verifyDeviceSig (o: { publickey: string, data: unknown, signature: string }): Promise<boolean>
  export function pubkeyId (publicJwk: string | JsonWebKey): Promise<string>
  export function keyLabel (publicJwk: string | JsonWebKey): Promise<string>
  export function makeDeviceKey (o?: { label?: string }): Promise<{ publickey: string, privateJwk: JsonWebKey }>
  export function makeDeviceEncKey (): Promise<{ encPublickey: string, encPrivateJwk: JsonWebKey }>
}

declare module '@dotrino/identity/channel' {
  export function makeEphemeral (): Promise<{ privateKey: CryptoKey, pub: string }>
  export function deriveKey (privateKey: CryptoKey, otherPubB64: string, salt: string | Uint8Array): Promise<CryptoKey>
  export function seal (key: CryptoKey, obj: unknown): Promise<{ iv: string, ct: string }>
  /** El JSON descifrado: quien lo abre comprueba su forma. */
  export function open (key: CryptoKey, env: { iv: string, ct: string }): Promise<any>
  export const b64: { enc (bytes: ArrayBuffer | Uint8Array): string, dec (s: string): Uint8Array }
}

declare module '@dotrino/identity/vault/remote.js' {
  export function requestDevices (o: {
    master: string, to?: string | null, timeoutMs?: number, proxy: string, device: object, cert: unknown,
    sinceSeq?: number, onRevoked?: () => void
  }): Promise<{ acta?: DotrinoActa } & Record<string, unknown>>
  export function requestRenew (o: { master: string, proxy: string, device: object, cert: unknown, onRevoked?: () => void }):
    Promise<{ cert: { seq?: number } & Record<string, unknown>, acta: DotrinoActa }>  // el pilar ya juzgó los dos (checkVaultReply)
}

declare module '@dotrino/vault/atrest' {
  export function atRestFor (dir: string, o?: { password?: string }): { encrypt (text: string): string, decrypt (text: string): string }
  export function isEncrypted (text: unknown): boolean
}

declare module '@dotrino/vault/invite' {
  export function parseInvite (text: string): { sn?: string, iss?: string, conn?: unknown } & Record<string, unknown>
}

declare module '@dotrino/vault/service' {
  export function enrollWithVault (o: {
    qr: string | object, label?: string, expectedScope?: string | null,
    onCode?: (c: { deviceId: string, code: string }) => void, approveTimeoutMs?: number
  }): Promise<{ device: { publickey: string, privateJwk: JsonWebKey }, enc: { publickey?: string, privateJwk?: JsonWebKey } & Record<string, unknown>, cert: { seq?: number } & Record<string, unknown>, iss: string, proxy: string }>
}

declare module '@dotrino/vault/protocol' {
  export const VAULT_PROTOCOL: number
  export const VAULT_SPEAKS: number[]
}

declare module '@dotrino/compat' {
  export function declare (o: { product: string, version: string, protocol: number, speaks?: number[], needs?: string[] }):
    { product: string, version: string, protocol: number, speaks: number[], needs?: string[] }
}
