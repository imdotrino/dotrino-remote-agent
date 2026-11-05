/**
 * client.js — lado del CLIENTE (navegador/PWA) de `@dotrino/remote-agent`.
 *
 * Habla con un agente remoto por el proxy del ecosistema (`@dotrino/proxy-client`).
 * El agente es otro dispositivo enrolado en el MISMO vault: lo direccionamos por SU
 * pubkey (`agentPubkey`) y verificamos que su `cert` encadena a la maestra que este
 * dispositivo vio al enlazar. Ambas puntas son peers certificados por el vault;
 * ninguna tiene la clave maestra.
 *
 * La firma de este lado la hace el PILAR de identidad (`id.signData`, dentro del
 * iframe id.dotrino.com): la clave del dispositivo es la identidad del navegador y
 * su cert (`P ← maestra`) viene del emparejamiento estándar del ecosistema
 * (profile.dotrino.com/#vault). Nada de claves privadas en la app.
 *
 * Handshake: firmamos la autorización → el agente responde un ack firmado con SU
 * `D` + su `cert` → verificamos la cadena a la maestra pineada (anti-MITM del
 * relay) → levantamos el canal cifrado (ECDH → AES-GCM).
 *
 * Una vez conectado, `send(payload)` envía un objeto de dominio arbitrario (la app
 * define la forma: terminal pasa `{type:'cmd',...}`, ia pasa `{type:'msg',...}`) y
 * `on('message', cb)` recibe los payloads del agente, ya descifrados.
 */
import { verifyChain } from '@dotrino/identity/capabilities'
import { sealersOf, samePubkey, canAdopt } from '@dotrino/identity/acta'
import { makeEphemeral, deriveKey, seal, open } from '../e2e.js'
import { canGreet } from './membership.js'
import { HS, ACK, DATA, PING, PONG, ERROR, DEFAULT_PROXY } from '../protocol.js'

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
  constructor (link, { agentPubkey, proxyUrl, trustedActa = null } = {}) {
    this.link = link                                  // { id, cert, iss, proxy, mode? }
    this.trustedActa = trustedActa
    this.agentPubkey = agentPubkey                    // pubkey del agente destino
    this.proxyUrl = proxyUrl || link.proxy || DEFAULT_PROXY
    /** @type {import('@dotrino/proxy-client').WebSocketProxyClient | null} */
    this.client = null
    /** @type {CryptoKey | null} */
    this.key = null
    /** @type {string | null} */
    this.sid = null
    /** @type {Record<string, Array<(...args: any[]) => void>>} */
    this._h = { message: [], error: [], resumed: [] }
    /** @type {Promise<void> | null} */
    this._resuming = null
    /** @type {Promise<void> | undefined} */
    this._in = undefined
    /** @type {Promise<void> | undefined} */
    this._out = undefined
    /** @type {unknown} */
    this.actaCacheError = undefined
    // El token del agente: una vez que contesta el saludo se le habla POR TOKEN, que es lo
    // único que sube a WebRTC. `null` es «todavía no lo sé» y se va por su pubkey.
    /** @type {string | null} */
    this.agentToken = null
    /** @type {Set<string>} */
    this._directPeers = new Set()
  }

  /**
   * Suscribe a eventos. Devuelve un `off()` para desuscribir. Eventos: message, error, resumed.
   * @param {'message' | 'error' | 'resumed'} ev
   * @param {(...args: any[]) => void} cb
   * @returns {() => void}
   */
  on (ev, cb) {
    if (!this._h[ev]) this._h[ev] = []
    this._h[ev].push(cb)
    return () => { this._h[ev] = this._h[ev].filter((f) => f !== cb) }
  }

  /** @param {string} ev @param {...unknown} args */
  _emit (ev, ...args) { for (const h of (this._h[ev] || [])) { try { h(...args) } catch (_) {} } }

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
  async _acta () {
    if (this.link.acta) return this.link.acta
    const id = this.link.id
    /** @type {DotrinoActa | null} */
    let acta = null
    try { acta = (await id?.listVaultDevices?.())?.acta || null } catch (_) {}
    if (!acta) { try { acta = (await id?.profileActa?.())?.acta || null } catch (_) {} }
    return acta
  }

  async _identify () {
    // En modo self NO identificamos esta conexión como P: el proxy enruta por token
    // las respuestas del agente (no por pubkey), y así no recibimos el fan-out de
    // mensajes dirigidos a P (que atiende el listener de enrolamiento). La
    // autorización la da el vault/self-cert que va firmado en el handshake.
    if (this.link.mode === 'self') return
    const client = this._client()
    if (!client.token) return
    // Patrón estándar del ecosistema (messenger): identify firmado por id.signData
    // + cert del vault → el proxy enruta también lo dirigido a la maestra.
    const { id, cert } = this.link
    const publickey = id.me?.publickey
    if (!publickey) return
    // El sobre lo arma el pilar (`identifyAs`), que le pone el destinatario.
    await client.identifyAs({ publickey, sign: (d) => id.signData(d), cert })
  }

  async connect () {
    if (!this.agentPubkey) throw new Error('the target agent address is missing')
    const { WebSocketProxyClient } = await import('@dotrino/proxy-client')
    // SIEMPRE EL CAMINO MÁS DIRECTO: WebRTC encendido. Estuvo en `false` desde el 0.1.0
    // porque entonces Node no tenía con qué; se quedó así cuando ya lo tuvo, y dos equipos
    // en la misma red se hablaban dando la vuelta por el proxio.
    // Solo negocia canal directo quien contestó NUESTRO saludo.
    const client = new WebSocketProxyClient({
      url: this.proxyUrl, autoReconnect: true,
      acceptDirectFrom: (token) => this._directPeers.has(token)
    })
    this.client = client
    await client.connect()
    await this._identify()
    if (this.link.mode !== 'self') {
      client.on('token', () => { this._identify().catch(() => {}) })
    }

    // El agente se reinició: su token ya no existe. El pilar ya mandó ese mensaje por su
    // pubkey; aquí solo se deja de usar el token hasta el próximo saludo.
    client.on('token_gone', (/** @type {string} */ token) => {
      this._directPeers.delete(token)
      if (token === this.agentToken) this.agentToken = null
    })

    client.on('message', (_from, p) => {
      if (!p || typeof p !== 'object') return
      if (p.type === DATA && p.sid === this.sid && this.key) {
        // Se entregan en el orden en que llegaron: descifrar tarda según el tamaño, y sin
        // esta cola un mensaje pequeño adelantaba a uno grande que llegó antes.
        const opened = open(this.key, p.env).then((m) => ({ m }), () => null)
        this._in = (this._in || Promise.resolve()).then(() => opened).then((r) => { if (r) this._emit('message', r.m) })
      } else if (p.type === ERROR) {
        this._onAgentError(p)
      }
    })

    await this._handshake()
    return this
  }

  /**
   * Un error del agente. Si es que ya no conoce NUESTRA sesión (se reinició: las sesiones
   * viven en su memoria), se vuelve a saludar solo y se avisa con `resumed`; lo que la app
   * tenía abierto allí lo decide la app. Cualquier otro error, o no poder volver a saludar,
   * sale por `error`. Un `unknown-session` de un `sid` que ya no es el nuestro (llegó tarde,
   * de antes de volver a saludar) no dice nada nuevo y se ignora.
   */
  /** @param {{ code?: string, error?: string, reason?: string, sid?: string }} p */
  _onAgentError (p) {
    if (p.code !== 'unknown-session') { this._emit('error', Object.assign(new Error(p.error), { code: p.code, reason: p.reason })); return }
    if (p.sid !== this.sid) return
    this._resume()
  }

  /** Vuelve a saludar, una sola vez aunque lleguen varios errores seguidos. */
  /** @returns {Promise<void>} */
  _resume () {
    if (this._resuming) return this._resuming
    this.key = null
    this._resuming = this._handshake()
      .then(() => { this._emit('resumed', { sid: this.sid }) })
      .catch((e) => { this._emit('error', e) })
      .finally(() => { this._resuming = null })
    return this._resuming
  }

  /** El saludo: abre una sesión con el agente y deja `sid` y `key`. */
  async _handshake () {
    const eph = await makeEphemeral()
    // El self-cert P←P del modo self puede vencerse (24 h): refrescarlo si hace falta.
    let cert = this.link.cert
    if (this.link.mode === 'self' && this.link.getSelfCert) {
      cert = await this.link.getSelfCert()
    }
    // `publickey` va DENTRO del dato firmado: verifyChain verifica la firma contra
    // data.publickey y exige cert.sub === data.publickey.
    const data = { op: HS, eph: eph.pub, publickey: this.link.id.me?.publickey, ts: Date.now() }
    const { signature } = await this.link.id.signData(data)

    // El ACK se correlaciona por la clave efímera PROPIA (ceph === eph.pub): así
    // varias sesiones simultáneas (varios RemoteAgentClient sobre la misma pubkey)
    // no se roban el ACK de la otra.
    const client = this._client()
    /** @type {Promise<AgentAck>} */
    const acked = new Promise((resolve, reject) => {
      const off = client.on('message', (from, p) => {
        if (!p || typeof p !== 'object') return
        // El token se apunta AQUÍ, en el mismo tic: si el agente es quien abre el canal
        // directo, su oferta llega justo detrás del ack y tiene que encontrarlo ya.
        if (p.type === ACK && p.ack && p.ack.ceph === eph.pub) { off(); if (from) this._directPeers.add(from); resolve({ ...p, from }) }
        else if (p.type === ERROR) { off(); reject(Object.assign(new Error(p.error), { code: p.code, reason: p.reason })) }
      })
      setTimeout(() => { off(); reject(new Error('the agent did not reply (is it running there?)')) }, 20000)
    })
    client.sendByPubkey(/** @type {string} */ (this.agentPubkey), { type: HS, data, signature, cert })
    const res = await acked
    try { await this._checkAck(res, eph) } catch (e) { if (res.from) this._directPeers.delete(res.from); throw e }
    this.agentToken = res.from || null
  }

  /**
   * Comprueba el ack y deja `sid` y `key`.
   * @param {AgentAck} res
   * @param {{ privateKey: CryptoKey, pub: string }} eph
   */
  async _checkAck (res, eph) {
    // PRIMERO EL ACTA QUE YA SE TIENE (`trustedActa`), y la bóveda solo si con esa no pasa.
    // Preguntarle en cada saludo hacía esperar a la ventana 4-17 s antes de pedir la clave de
    // otra máquina (2026-11-04): el ack llega en medio segundo, el acta tardaba el resto. Si
    // no pasa puede ser que el acta guardada vaya atrás (una máquina recién emparejada): se
    // pregunta a la bóveda y se juzga otra vez, una sola, como hace el agente con un saludo.
    let local = null
    try { local = this.trustedActa?.() || null } catch (_) {}
    if (local) {
      try { return await this._judgeAck(res, eph, local) } catch (e) { if (/** @type {{ code?: string }} */ (e).code !== 'unauthorized') throw e }
      // Va atrás: antes que la bóveda, la caché de actas del proxio (websocket-proxy ≥ 1.10.0).
      const newer = await this._actaFromProxy(local)
      if (newer) {
        try { return await this._judgeAck(res, eph, newer) } catch (e) { if (/** @type {{ code?: string }} */ (e).code !== 'unauthorized') throw e }
      }
    }
    return this._judgeAck(res, eph, await this._acta())
  }

  /**
   * La más nueva de la caché del proxio que ENCADENE desde `trusted` (`canAdopt`), o `null`.
   * El proxio no es de fiar: lo que no encadena se ignora. Si no se pudo preguntar, el motivo
   * queda en `actaCacheError` y se sigue con la bóveda, que es quien manda.
   */
  /** @param {DotrinoActa} trusted @returns {Promise<DotrinoActa | null>} */
  async _actaFromProxy (trusted) {
    if (!trusted?.profileId) return null
    /** @type {DotrinoActa[]} */
    let list
    try { list = /** @type {DotrinoActa[]} */ (await this._client().getActas(trusted.profileId, { sinceSeq: trusted.seq })) } catch (e) { this.actaCacheError = e; return null }
    for (const a of list) if ((await canAdopt({ candidate: a, current: trusted })).adopt) return a
    return null
  }

  /**
   * Juzga el ack con `acta` y, si pasa, deja `sid` y `key`.
   * @param {AgentAck} res
   * @param {{ privateKey: CryptoKey, pub: string }} eph
   * @param {DotrinoActa | null} acta
   */
  async _judgeAck (res, eph, acta) {

    // El ack debe: (1) encadenar a NUESTRA maestra, (2) estar firmado por el agente
    // que apuntamos, (3) atar nuestra pub efímera y el sid.
    //
    // CON EL ACTA, o no se juzga. Desde que el papel no vence, `verifyChain` necesita el
    // `seq` del acta y su lista de SELLADORAS: sin eso no puede decir si quien firmó el
    // papel del agente podía hacerlo, y contesta `no-record` — que es lo correcto, porque
    // decir «vale» sin haber comprobado nada es como entraba un papel viejo. Aquí no se le
    // pasaba: el lado del agente sí lo hacía (`contextoActa`) y este lado se quedó atrás,
    // así que TODA sesión moría con «el agente no está certificado por tu vault: no-record».
    // `clientLink` no trae el acta, así que se le pide a la bóveda (`_acta`) o llega hecha.
    const chk = await verifyChain({
      data: res.ack, signature: res.signature, cert: res.cert,
      actaSeq: acta?.seq ?? null, sealers: acta ? sealersOf(acta) : null
    })
    if (!chk.ok) throw Object.assign(new Error('the agent is not certified by your vault: ' + chk.reason), { code: 'unauthorized', reason: chk.reason })
    // QUIEN FIRMA ES LA MÁQUINA QUE SE PIDIÓ. `machine` es un campo más del ack: lo que prueba
    // quién contesta es la llave que firma (`publickey`, la que `verifyChain` comprobó).
    // Mirar solo `machine` dejaba a cualquier llave con papel de la cuenta hacerse pasar por
    // otra máquina, con un relevo que le pasara el saludo.
    if (!samePubkey(chk.device, this.agentPubkey) || !samePubkey(res.ack.machine, this.agentPubkey)) {
      throw Object.assign(new Error('the ack came from another agent'), { code: 'unauthorized', reason: 'wrong-agent' })
    }
    // Y ESA MÁQUINA SIGUE EN EL ACTA. El papel no caduca: el de una máquina quitada (robada)
    // sigue bien firmado. La misma regla que aplica el agente a quien le saluda.
    if (!canGreet(acta, this.agentPubkey)) {
      throw Object.assign(new Error('that machine is no longer in your account'), { code: 'unauthorized', reason: 'not-in-record' })
    }
    if (res.ack.ceph !== eph.pub || res.ack.sid !== res.sid) throw new Error('the ack does not match this handshake')

    this.sid = res.sid
    this.key = await deriveKey(eph.privateKey, res.ack.seph, res.sid)
  }

  /**
   * Envía un payload de dominio cifrado al agente (si se está volviendo a saludar, después).
   * @param {unknown} payload
   * @returns {Promise<void>}
   */
  async send (payload) {
    if (this._resuming) await this._resuming
    if (!this.key) throw Object.assign(new Error('no session with the agent'), { code: 'no-session' })
    const client = this._client()
    const agentPubkey = /** @type {string} */ (this.agentPubkey)  // `connect` la exigió
    // Salen en el orden en que se pidieron, tarde lo que tarde en cifrarse cada uno.
    const sid = this.sid
    const sealed = seal(this.key, payload)
    const turn = (this._out || Promise.resolve()).then(() => sealed).then((env) => {
      const msg = { type: DATA, sid, env }
      // Por token en cuanto se sabe: sube al canal directo, y si el token murió el pilar lo
      // saca por la pubkey. Por pubkey solo mientras no hay token.
      if (this.agentToken) client.sendToOrQueue(this.agentToken, msg, { peerPubkey: agentPubkey })
      else client.sendByPubkey(agentPubkey, msg)
    })
    this._out = turn.catch(() => {})
    return turn
  }

  /**
   * Sonda de presencia (liveness) sin abrir sesión. Devuelve true si responde.
   * @param {{ timeoutMs?: number }} [o]
   * @returns {Promise<boolean>}
   */
  async ping ({ timeoutMs = 4000 } = {}) {
    const client = this._client()
    const n = crypto.getRandomValues(new Uint8Array(8)).join('')
    /** @type {Promise<boolean>} */
    const got = new Promise((resolve) => {
      const off = client.on('message', (_f, p) => {
        if (p?.type === PONG && p.n === n) { off(); resolve(true) }
      })
      setTimeout(() => { off(); resolve(false) }, timeoutMs)
    })
    // Efímero, como `probeAgents`: si no está, no se encola ni se le timbra.
    client.sendByPubkey(/** @type {string} */ (this.agentPubkey), { type: PING, n }, { ephemeral: true })
    return got
  }

  async close () {
    try { this.client?.close() } catch {}
  }

  /** El transporte, que existe desde `connect`. Usarlo antes es un fallo de quien llama. */
  _client () {
    if (!this.client) throw Object.assign(new Error('not connected: call connect() first'), { code: 'not-connected' })
    return this.client
  }
}

export default { RemoteAgentClient }
