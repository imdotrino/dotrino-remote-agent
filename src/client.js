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
    this._h = { message: [], error: [] }
  }

  /** Suscribe a eventos. Devuelve un `off()` para desuscribir. Eventos: message, error. */
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
    const data = { op: 'identify', publickey, token: this.client.token, ts: Date.now() }
    const { signature } = await id.signData(data)
    await this.client.identify({ data, signature, cert })
  }

  async connect () {
    if (!this.agentPubkey) throw new Error('falta la dirección del agente destino')
    const { WebSocketProxyClient } = await import('@dotrino/proxy-client')
    this.client = new WebSocketProxyClient({ url: this.proxyUrl, enableWebRTC: false, autoReconnect: true })
    await this.client.connect()
    await this._identify()
    if (this.link.mode !== 'self') {
      this.client.on('token', () => { this._identify().catch(() => {}) })
    }

    this.client.on('message', async (_from, p) => {
      if (!p || typeof p !== 'object') return
      if (p.type === DATA && p.sid === this.sid) {
        try { const m = await open(this.key, p.env); this._emit('message', m) } catch {}
      } else if (p.type === ERROR) {
        this._emit('error', new Error(p.error))
      }
    })

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
      const off = this.client.on('message', (_from, p) => {
        if (!p || typeof p !== 'object') return
        if (p.type === ACK && p.ack && p.ack.ceph === eph.pub) { off(); resolve(p) }
        else if (p.type === ERROR) { off(); reject(new Error(p.error)) }
      })
      setTimeout(() => { off(); reject(new Error('el agente no respondió (¿está corriendo allí?)')) }, 20000)
    })
    this.client.sendByPubkey(this.agentPubkey, { type: HS, data, signature, cert })
    const res = await acked

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
    return this
  }

  /** Envía un payload de dominio cifrado al agente. */
  async send (payload) {
    const env = await seal(this.key, payload)
    this.client.sendByPubkey(this.agentPubkey, { type: DATA, sid: this.sid, env })
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
    this.client.sendByPubkey(this.agentPubkey, { type: PING, n })
    return got
  }

  async close () {
    try { this.client?.close() } catch {}
  }
}

export default { RemoteAgentClient }
