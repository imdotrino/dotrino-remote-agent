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
import { sealersOf } from '@dotrino/identity/acta'
import { makeEphemeral, deriveKey, seal, open } from '../e2e.js'
import { HS, ACK, DATA, PING, PONG, ERROR } from '../protocol.js'

export class RemoteAgentClient {
  /**
   * @param {{ id:object, cert:object, iss:string, proxy?:string, mode?:string }} link
   *   enlace del vault (modo vault) o de @dotrino/vault (modo self: el dispositivo
   *   es su propio vault; `cert` es el self-cert `P ← P` e `iss` es la propia P).
   * @param {object} opts
   * @param {string} opts.agentPubkey dirección (pubkey) del agente destino.
   * @param {string} [opts.proxyUrl]  override del proxy del enlace.
   */
  constructor (link, { agentPubkey, proxyUrl } = {}) {
    this.link = link                                  // { id, cert, iss, proxy, mode? }
    this.agentPubkey = agentPubkey                    // pubkey del agente destino
    this.proxyUrl = proxyUrl || link.proxy || 'wss://proxy.dotrino.com'
    this.client = null
    this.key = null
    this.sid = null
    this._h = { message: [], error: [], resumed: [] }
    this._resuming = null
    // El token del agente: una vez que contesta el saludo se le habla POR TOKEN, que es lo
    // único que sube a WebRTC. `null` es «todavía no lo sé» y se va por su pubkey.
    this.agentToken = null
    this._directPeers = new Set()
  }

  /** Suscribe a eventos. Devuelve un `off()` para desuscribir. Eventos: message, error, resumed. */
  on (ev, cb) {
    if (!this._h[ev]) this._h[ev] = []
    this._h[ev].push(cb)
    return () => { this._h[ev] = this._h[ev].filter((f) => f !== cb) }
  }

  _emit (ev, ...args) { for (const h of (this._h[ev] || [])) { try { h(...args) } catch (_) {} } }

  /**
   * El acta con la que se juzga el papel del agente. Se pide UNA vez por cliente y se
   * guarda: es la política vigente del perfil, no cambia a mitad de una sesión.
   *
   * Si no se puede traer, se devuelve `null` a propósito y `verifyChain` corta con
   * `no-acta`. No hay repliegue: sin acta no hay con qué decidir, y no decidir es que no.
   */
  async _acta () {
    if (this._actaCache !== undefined) return this._actaCache
    let acta = this.link.acta || null
    if (!acta) {
      try { acta = (await this.link.id?.listVaultDevices?.())?.acta || null } catch (_) { acta = null }
    }
    this._actaCache = acta
    return acta
  }

  async _identify () {
    // En modo self NO identificamos esta conexión como P: el proxy enruta por token
    // las respuestas del agente (no por pubkey), y así no recibimos el fan-out de
    // mensajes dirigidos a P (que atiende el listener de enrolamiento). La
    // autorización la da el vault/self-cert que va firmado en el handshake.
    if (this.link.mode === 'self') return
    if (!this.client.token) return
    // Patrón estándar del ecosistema (messenger): identify firmado por id.signData
    // + cert del vault → el proxy enruta también lo dirigido a la maestra.
    const { id, cert } = this.link
    const publickey = id.me?.publickey
    if (!publickey) return
    // El sobre lo arma el pilar (`identifyAs`), que le pone el destinatario.
    await this.client.identifyAs({ publickey, sign: (d) => id.signData(d), cert })
  }

  async connect () {
    if (!this.agentPubkey) throw new Error('falta la dirección del agente destino')
    const { WebSocketProxyClient } = await import('@dotrino/proxy-client')
    // SIEMPRE EL CAMINO MÁS DIRECTO: WebRTC encendido. Estuvo en `false` desde el 0.1.0
    // porque entonces Node no tenía con qué; se quedó así cuando ya lo tuvo, y dos equipos
    // en la misma red se hablaban dando la vuelta por el proxio.
    // Solo negocia canal directo quien contestó NUESTRO saludo.
    this.client = new WebSocketProxyClient({
      url: this.proxyUrl, autoReconnect: true,
      acceptDirectFrom: (token) => this._directPeers.has(token)
    })
    await this.client.connect()
    await this._identify()
    if (this.link.mode !== 'self') {
      this.client.on('token', () => { this._identify().catch(() => {}) })
    }

    // El agente se reinició: su token ya no existe. El pilar ya mandó ese mensaje por su
    // pubkey; aquí solo se deja de usar el token hasta el próximo saludo.
    this.client.on('token_gone', (token) => {
      this._directPeers.delete(token)
      if (token === this.agentToken) this.agentToken = null
    })

    this.client.on('message', async (_from, p) => {
      if (!p || typeof p !== 'object') return
      if (p.type === DATA && p.sid === this.sid) {
        try { const m = await open(this.key, p.env); this._emit('message', m) } catch {}
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
  _onAgentError (p) {
    if (p.code !== 'unknown-session') { this._emit('error', Object.assign(new Error(p.error), { code: p.code })); return }
    if (p.sid !== this.sid) return
    this._resume()
  }

  /** Vuelve a saludar, una sola vez aunque lleguen varios errores seguidos. */
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
    const acked = new Promise((resolve, reject) => {
      const off = this.client.on('message', (from, p) => {
        if (!p || typeof p !== 'object') return
        // El token se apunta AQUÍ, en el mismo tic: si el agente es quien abre el canal
        // directo, su oferta llega justo detrás del ack y tiene que encontrarlo ya.
        if (p.type === ACK && p.ack && p.ack.ceph === eph.pub) { off(); if (from) this._directPeers.add(from); resolve({ ...p, from }) }
        else if (p.type === ERROR) { off(); reject(new Error(p.error)) }
      })
      setTimeout(() => { off(); reject(new Error('el agente no respondió (¿está corriendo allí?)')) }, 20000)
    })
    this.client.sendByPubkey(this.agentPubkey, { type: HS, data, signature, cert })
    const res = await acked
    try { await this._checkAck(res, eph) } catch (e) { this._directPeers.delete(res.from); throw e }
    this.agentToken = res.from || null
  }

  /** Comprueba el ack y deja `sid` y `key`. */
  async _checkAck (res, eph) {

    // El ack debe: (1) encadenar a NUESTRA maestra, (2) estar firmado por el agente
    // que apuntamos, (3) atar nuestra pub efímera y el sid.
    //
    // CON EL ACTA, o no se juzga. Desde que el papel no vence, `verifyChain` necesita el
    // `seq` del acta y su lista de SELLADORAS: sin eso no puede decir si quien firmó el
    // papel del agente podía hacerlo, y contesta `no-acta` — que es lo correcto, porque
    // decir «vale» sin haber comprobado nada es como entraba un papel viejo. Aquí no se le
    // pasaba: el lado del agente sí lo hacía (`contextoActa`) y este lado se quedó atrás,
    // así que TODA sesión moría con «el agente no está certificado por tu vault: no-acta».
    // `clientLink` no trae el acta, así que se le pide a la bóveda una vez y se guarda.
    const acta = await this._acta()
    const chk = await verifyChain({
      data: res.ack, signature: res.signature, cert: res.cert, trustedIssuer: this.link.iss,
      actaSeq: acta?.seq ?? null, sealers: acta ? sealersOf(acta) : null
    })
    if (!chk.ok) throw new Error('el agente no está certificado por tu vault: ' + chk.reason)
    if (res.ack.machine !== this.agentPubkey) throw new Error('el ack vino de otro agente')
    if (res.ack.ceph !== eph.pub || res.ack.sid !== res.sid) throw new Error('ack no corresponde a este handshake')

    this.sid = res.sid
    this.key = await deriveKey(eph.privateKey, res.ack.seph, res.sid)
  }

  /** Envía un payload de dominio cifrado al agente (si se está volviendo a saludar, después). */
  async send (payload) {
    if (this._resuming) await this._resuming
    if (!this.key) throw Object.assign(new Error('no session with the agent'), { code: 'no-session' })
    const env = await seal(this.key, payload)
    const msg = { type: DATA, sid: this.sid, env }
    // Por token en cuanto se sabe: sube al canal directo, y si el token murió el pilar lo
    // saca por la pubkey. Por pubkey solo mientras no hay token.
    if (this.agentToken) this.client.sendToOrQueue(this.agentToken, msg, { peerPubkey: this.agentPubkey })
    else this.client.sendByPubkey(this.agentPubkey, msg)
  }

  /** Sonda de presencia (liveness) sin abrir sesión. Devuelve true si responde. */
  async ping ({ timeoutMs = 4000 } = {}) {
    const n = crypto.getRandomValues(new Uint8Array(8)).join('')
    const got = new Promise((resolve) => {
      const off = this.client.on('message', (_f, p) => {
        if (p?.type === PONG && p.n === n) { off(); resolve(true) }
      })
      setTimeout(() => { off(); resolve(false) }, timeoutMs)
    })
    // Efímero, como `probeAgents`: si no está, no se encola ni se le timbra.
    this.client.sendByPubkey(this.agentPubkey, { type: PING, n }, { ephemeral: true })
    return got
  }

  async close () {
    try { this.client?.close() } catch {}
  }
}

export default { RemoteAgentClient }
