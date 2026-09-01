/**
 * agent.js — lado del AGENTE (Node) de `@dotrino/remote-agent`.
 *
 * Abre sesiones cifradas punto a punto SOLO para dispositivos enlazados al mismo
 * vault. Puede correr en CUALQUIER máquina: se enrola con el vault como un
 * dispositivo más (ver link.js), así que NO necesita la maestra — solo su propia
 * sub-clave `D` + `cert` y la pública maestra pineada (`iss`).
 *
 * Autorización = el vault. Cada `ra.hs` llega firmado por la `D` del cliente con su
 * `cert`; el agente verifica la cadena `D_cliente ← maestra` (misma maestra que la
 * suya) con `verifyChain`. Ambas puntas son peers certificados por el mismo vault;
 * ninguna tiene la clave maestra. El ack lo firma el agente con SU `D` y adjunta su
 * `cert`, para que el cliente compruebe que habla con un agente que el vault certificó
 * (anti-MITM del relay).
 *
 * Transporte = el proxy (`@dotrino/proxy-client`): el agente se identifica bajo SU
 * pubkey y el cliente lo direcciona por ella. Revocación: refresca la lista del vault
 * por el proxy; si está offline, usa la última cacheada + el TTL del cert acota el
 * riesgo. Los payloads de dominio viajan cifrados E2E (../e2e.js) dentro del tipo
 * `DATA` genérico — el agente NO sabe nada de PTY ni de IA.
 */
import fs from 'node:fs'
import path from 'node:path'
import { verifyChain, signWithDevice, verifyDeviceSig, verifyDelegation, pubkeyId } from '@dotrino/identity/capabilities'
import { sealersOf } from '@dotrino/identity/acta'
import { installNodeGlobals } from '../node-globals.js'
import { makeEphemeral, deriveKey, seal, open } from '../e2e.js'
import { HS, ACK, DATA, PING, PONG, ERROR, VMSG, SIGN_SCOPE, SESSION_TTL_MS, REVOKE_REFRESH_MS } from '../protocol.js'
import { loadLink, saveLink, dataDir } from './link.js'

/** Sesión cifrada con un dispositivo cliente. La app recibe esto en `onSession`. */
class AgentSession {
  constructor ({ sid, key, from, device, send }) {
    this.sid = sid
    this.key = key
    this.from = from                  // token del cliente en el proxy
    this.device = device              // pubkey del dispositivo cliente
    this._send = send                 // (to, obj) => void
    this._h = { message: [], close: [] }
    this._closed = false
  }

  /** Envía un payload de dominio cifrado al cliente. */
  async send (payload) {
    if (this._closed) return
    const env = await seal(this.key, payload).catch(() => null)
    if (env) this._send(this.from, { type: DATA, sid: this.sid, env })
  }

  on (ev, cb) { this._h[ev]?.push(cb); return this }

  async _ingest (env) {
    let msg
    try { msg = await open(this.key, env) } catch { return }
    for (const h of this._h.message) { try { h(msg) } catch (_) {} }
  }

  close () {
    if (this._closed) return
    this._closed = true
    for (const h of this._h.close) { try { h() } catch (_) {} }
  }
}

/**
 * Arranca el agente. Devuelve `{ machine, machineId, master, close }`.
 *
 * @param {object} opts
 * @param {string} [opts.label]       label del dispositivo (para logging; el real vive en link.json).
 * @param {string} [opts.proxyUrl]    default wss://proxy.dotrino.com.
 * @param {string} [opts.dir]         dir del enlace (default dataDir()).
 * @param {object} [opts.link]        enlace ya cargado (override de dir).
 * @param {(session:AgentSession)=>void} [opts.onSession]  cada handshake exitoso abre una sesión.
 * @param {()=>void} [opts.onRevoked] se llamó al auto-borrarse por revocación.
 * @param {()=>void} [opts.onReady]   agente listo y escuchando.
 * @param {boolean} [opts.quiet]      sin logs.
 * @param {object} [opts.client]      transporte ya conectado (SOLO pruebas).
 *
 * Devuelve además el **`client`** (el `WebSocketProxyClient` ya conectado e
 * identificado bajo la pubkey de esta máquina). Se expone a propósito: un agente
 * que necesite algo más del transporte —anunciarse en un canal, por ejemplo— debe
 * reusar ESTA conexión y no abrir otra. Dos conexiones del mismo aparato al proxy
 * son dos identidades de transporte, dos `identify` y dos colas: exactamente el
 * lío que este middleware existe para evitar.
 */
export async function startRemoteAgent (opts = {}) {
  const dir = opts.dir || dataDir()
  const link = opts.link || loadLink(dir)
  if (!link?.device?.privateJwk || !link?.cert || !link?.iss) {
    throw new Error('esta máquina no está enlazada. Ejecuta primero el enrolamiento (enroll) de tu agente.')
  }
  const master = link.iss
  const myPub = link.device.publickey
  const myId = (await pubkeyId(myPub)).slice(0, 8).toUpperCase().replace(/(.{4})(.{4})/, '$1-$2')

  installNodeGlobals(dir)

  const proxyUrl = opts.proxyUrl || process.env.PROXY_URL || link.proxy || 'wss://proxy.dotrino.com'
  // `client` inyectado: solo para las pruebas (transporte de mentira). En producción se
  // levanta el del ecosistema — no hay otro transporte.
  const client = opts.client || await (async () => {
    const { getWebSocketProxyClient } = await import('@dotrino/proxy-client')
    const c = getWebSocketProxyClient({
      url: proxyUrl, enableWebRTC: false, autoReconnect: true,
      maxReconnectAttempts: 100000, reconnectDelay: 4000
    })
    await c.connect()
    return c
  })()

  // Identificarse bajo la pubkey de ESTA máquina (firmado con su D).
  const identify = async () => {
    if (!client.token) return
    const data = { op: 'identify', publickey: myPub, token: client.token, ts: Date.now() }
    const { signature } = await signWithDevice({ privateJwk: link.device.privateJwk, data })
    await client.identify({ data, signature })
  }
  await identify()
  client.on('token', () => { identify().catch(() => {}) })

  // Bitácora persistente (sessions.log, JSONL): qué dispositivo abrió sesión y cuándo
  // — auditoría local si un dispositivo tuyo cae en malas manos.
  const sessionsLog = path.join(dir, 'sessions.log')
  const audit = (op, info = {}) => {
    try { fs.appendFileSync(sessionsLog, JSON.stringify({ ts: Date.now(), op, ...info }) + '\n') } catch (_) {}
  }

  const send = (to, obj) => { try { client.send(to, obj) } catch (e) { if (!opts.quiet) console.error('[remote-agent] send:', e.message) } }

  /**
   * Petición firmada a la bóveda por el proxy, dirigida a su pubkey maestra. Es el
   * mismo sobre para todo (`data` firmado con la D + el cert de esta máquina): lo
   * comparten el refresco de revocaciones y la renovación del cert.
   */
  async function vaultRpc (sendType, okType, data, timeoutMs = 15000) {
    const { signature } = await signWithDevice({ privateJwk: link.device.privateJwk, data })
    return new Promise((resolve, reject) => {
      // El temporizador se LIMPIA al contestar (y no retiene el bucle de eventos):
      // sin eso, cada consulta al vault dejaba 15 s de espera pendiente y un proceso
      // corto que solo quería preguntar algo se quedaba colgado hasta que vencía.
      const done = (fn, v) => { off(); clearTimeout(timer); fn(v) }
      const off = client.on('message', (_f, p) => {
        if (p?.type === okType) done(resolve, p)
        else if (p?.type === VMSG.ERROR) done(reject, new Error(p.error))
      })
      const timer = setTimeout(() => done(reject, new Error('timeout')), timeoutMs)
      timer.unref?.()
      client.sendByPubkey(master, { type: sendType, data, signature, cert: link.cert })
    })
  }

  // --- Revocación: refrescar la lista del vault por el proxy (best-effort) ---
  let revokedSet = new Set()
  async function refreshRevocations () {
    try {
      const res = await vaultRpc(VMSG.DEVICES, VMSG.DEVICES_RESULT, { op: 'devices', publickey: myPub, ts: Date.now() })
      revokedSet = new Set((res.revoked || []).map((r) => r.nonce || r))
      // El acta viaja con la lista. Apuntar su `seq` es lo que dispara la renovación en el
      // mismo tic si el dueño nos cambió los permisos.
      anotarActa(res.acta)
    } catch (e) {
      if (!opts.quiet) console.error('[remote-agent] could not refresh revocations (using cache):', e.message)
    }
  }

  /**
   * RENOVACIÓN del cert (`vault.renew`). YA NO ES UNA TAREA DE CALENDARIO: el papel no
   * vence, lleva el `seq` del acta con el que se emitió. Se pide uno nuevo cuando el ACTA
   * dice algo distinto de lo que lleva escrito — o sea, cuando el dueño cambió permisos.
   *
   * Antes se pedía al acercarse la caducidad, y eso obligaba a que la bóveda pudiera firmar
   * sola cada mes; era el último motivo por el que la maestra tenía que estar disponible sin
   * nadie delante. Ahora renovar ocurre justo cuando ya hay una selladora abierta, porque
   * cambiar el acta ES tenerla abierta.
   *
   * El cert nuevo se VERIFICA antes de guardarlo, contra el ACTA que viene con él: quien lo
   * firmó tiene que ser selladora de ESTE perfil. Ya no se compara con una llave fija, para
   * que una segunda bóveda pueda emitir; lo que se fija es el perfil.
   */
  async function renewCertIfNeeded () {
    // ¿Nos quedamos atrás? Lo sabemos por el acta que la bóveda manda con cada respuesta.
    const visto = link.actaSeq
    if (typeof visto !== 'number' || typeof link.cert?.seq !== 'number' || visto <= link.cert.seq) return
    try {
      const res = await vaultRpc(VMSG.RENEW, VMSG.RENEWED, { op: 'renew', publickey: myPub, ts: Date.now() })
      const cert = res?.cert
      const acta = res?.acta
      if (!cert || cert.sub !== myPub) throw new Error('the vault returned a cert that is not for this machine')
      if (!acta) throw new Error('the vault did not send its record: cannot check who signed this cert')
      if (acta.profileId !== master) throw new Error('the record is from a profile other than the pinned one')
      const v = await verifyDelegation({
        cert, expectedSub: myPub, expectedScope: SIGN_SCOPE,
        actaSeq: acta.seq, sealers: sealersOf(acta)
      })
      if (!v.ok) throw new Error(v.reason)
      link.cert = cert
      link.actaSeq = acta.seq
      saveLink(dir, link)
      audit('cert-renew', { seq: cert.seq })
      if (!opts.quiet) console.log(`[remote-agent] cert renewed against record #${cert.seq}`)
    } catch (e) {
      // No es fatal: el papel de antes sigue sirviendo para todo lo que el acta le siga
      // permitiendo, y el próximo tic reintenta. Se avisa igual: si esto falla, lo que el
      // dueño acaba de conceder no llega.
      if (!opts.quiet) console.error('[remote-agent] could not renew the cert:', e.message)
    }
  }

  /**
   * Guarda el acta que manda la bóveda. Hace dos cosas, y las dos hacen falta:
   *   · dispara la renovación cuando su `seq` pasa al del papel que tenemos;
   *   · es CON LO QUE SE JUZGA a quien nos habla — quien firma tiene que ser selladora de
   *     este perfil, y eso solo lo dice el acta. Por eso se PERSISTE: si viviera en memoria,
   *     al reiniciar el agente no podría atender a nadie hasta el primer tic.
   */
  function anotarActa (acta) {
    if (typeof acta?.seq !== 'number' || link.acta?.seq === acta.seq) return
    link.acta = acta
    link.actaSeq = acta.seq
    try { saveLink(dir, link) } catch (_) {}
  }

  /** El acta con la que se juzga un papel. Sin ella no se atiende a nadie. */
  const contextoActa = () => (link.acta
    ? { actaSeq: link.acta.seq, sealers: sealersOf(link.acta) }
    : { actaSeq: null, sealers: null })

  const vaultTick = async () => { await refreshRevocations(); await renewCertIfNeeded() }
  vaultTick()
  const revTimer = setInterval(vaultTick, REVOKE_REFRESH_MS); revTimer.unref?.()

  // sid -> AgentSession
  const sessions = new Map()
  const sweeper = setInterval(() => {
    const now = Date.now()
    for (const [sid, s] of sessions) {
      if (now > s._exp) { s.close(); sessions.delete(sid); audit('session-expire', { sid: sid.slice(0, 8) }) }
    }
  }, 60 * 1000); sweeper.unref?.()

  async function handleHandshake (from, p) {
    const { data, signature, cert } = p
    if (!data || !signature || !cert) return send(from, { type: ERROR, error: 'handshake incompleto' })
    // FRESCURA anti-replay: el HS debe ser reciente (±5 min); sin esto un relay
    // malicioso podía reproducir handshakes viejos (sesiones huérfanas / DoS).
    if (typeof data.ts !== 'number' || Math.abs(Date.now() - data.ts) > 5 * 60 * 1000) {
      return send(from, { type: ERROR, error: 'handshake vencido (posible replay, o el reloj del dispositivo está desfasado)' })
    }
    // Manda el acta, no una llave fija: con varias selladoras el papel de un peer puede
    // venir firmado por otra bóveda del mismo perfil. Sin acta no se atiende — no hay con
    // qué decidir, así que no se decide que sí.
    const chk = await verifyChain({ data, signature, cert, expectedScope: SIGN_SCOPE, ...contextoActa(), revoked: revokedSet })
    if (!chk.ok) return send(from, { type: ERROR, error: 'no autorizado: ' + chk.reason })
    if (data.op !== HS || typeof data.eph !== 'string') return send(from, { type: ERROR, error: 'handshake inválido' })

    const eph = await makeEphemeral()
    const sid = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('')
    const key = await deriveKey(eph.privateKey, data.eph, sid)
    // Ack firmado con la D de ESTA máquina + su cert: el cliente verifica la cadena
    // a la maestra y que la pub efímera viene de un agente certificado. `publickey`
    // va DENTRO del dato firmado (verifyChain lo exige: firma contra data.publickey
    // y cert.sub === data.publickey).
    const ack = { op: ACK, sid, seph: eph.pub, ceph: data.eph, machine: myPub, publickey: myPub, ts: Date.now() }
    const { signature: ackSig } = await signWithDevice({ privateJwk: link.device.privateJwk, data: ack })

    const session = new AgentSession({ sid, key, from, device: chk.device, send })
    session._exp = Date.now() + SESSION_TTL_MS
    sessions.set(sid, session)
    audit('session-open', { sid: sid.slice(0, 8), device: (await pubkeyId(chk.device)).slice(0, 8).toUpperCase() })
    send(from, { type: ACK, sid, ack, signature: ackSig, cert: link.cert })
    if (!opts.quiet) console.log(`[remote-agent] sesión ${sid.slice(0, 8)} autorizada (device ${chk.device?.slice?.(0, 8) || '?'})`)
    if (opts.onSession) { try { opts.onSession(session) } catch (e) { if (!opts.quiet) console.error('[remote-agent] onSession:', e.message) } }
  }

  function handleData (from, p) {
    const s = sessions.get(p.sid)
    if (!s) return send(from, { type: ERROR, error: 'sesión desconocida o expirada' })
    s._exp = Date.now() + SESSION_TTL_MS
    s.from = from
    s._ingest(p.env).catch(() => send(from, { type: ERROR, error: 'sobre inválido' }))
  }

  const stop = () => {
    clearInterval(revTimer); clearInterval(sweeper)
    for (const s of sessions.values()) s.close()
    try { client.close() } catch {}
  }

  // AUTO-BORRADO al ser REVOCADA: la bóveda envía un REVOKED FIRMADO por la maestra
  // dirigido a ESTA máquina (al revocar, o cuando reaparece). Solo nos borramos si la
  // firma valida y el body es para nuestra pubkey → un proxy/peer malicioso NO puede
  // borrarnos con un mensaje falso (cierra el wipe-DoS). Borra el enlace (link.json) y
  // detiene el agente.
  async function handleRevoked (p) {
    const b = p?.body
    if (!b || b.op !== 'revoke' || b.sub !== myPub) return
    if (typeof b.exp === 'number' && Date.now() > b.exp) return
    if (!await verifyDeviceSig({ publickey: master, data: b, signature: p.signature })) return
    audit('revoked', { nonce: b.nonce })
    if (!opts.quiet) console.log('\n[remote-agent] tu bóveda REVOCÓ esta máquina → borro el enlace y salgo.')
    try { fs.rmSync(path.join(dir, 'link.json'), { force: true }) } catch (_) {}
    stop()
    if (opts.onRevoked) { try { opts.onRevoked() } catch (_) {} }
  }

  client.on('message', (from, payload) => {
    if (!payload || typeof payload !== 'object') return
    if (payload.type === HS) handleHandshake(from, payload).catch((e) => send(from, { type: ERROR, error: e.message }))
    else if (payload.type === DATA) handleData(from, payload)
    // Sonda de presencia (liveness): el cliente hace ping y respondemos pong con el
    // mismo nonce → así la app sabe que el agente está online (sin abrir sesión).
    else if (payload.type === PING) send(from, { type: PONG, n: payload.n })
    else if (payload.type === VMSG.REVOKED) handleRevoked(payload).catch(() => {})
  })

  if (!opts.quiet) {
    console.log(`[remote-agent] agente activo · máquina ${myId} · vault ${(await pubkeyId(master)).slice(0, 16)} · proxy ${proxyUrl}`)
  }
  if (opts.onReady) { try { opts.onReady({ machine: myPub, machineId: myId, master }) } catch (_) {} }

  return { machine: myPub, machineId: myId, master, client, close: stop }
}

export default { startRemoteAgent }
