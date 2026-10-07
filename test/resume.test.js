/**
 * EL AGENTE SE REINICIÓ: el cliente vuelve a saludar solo.
 *
 * Las sesiones viven en la memoria del agente. Al reiniciarse (una actualización, un reset,
 * apagar y encender la máquina) deja de conocerlas, y a lo que le llega con un `sid` viejo
 * contesta `unknown-session`. Antes el cliente lo pasaba como un error cualquiera y la app se
 * quedaba enseñándolo («sesión desconocida o expirada») hasta que alguien recargaba.
 *
 * El saludo de verdad necesita una bóveda y un proxio, que aquí no hay: se sustituye por uno
 * que solo cambia el `sid`. Lo que se prueba es la decisión, no la cripto del saludo.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RemoteAgentClient } from '../src/client.js'
import { makeEphemeral, deriveKey } from '../e2e.js'

/** Una llave de sesión de verdad: `send` sella con ella. */
async function llaveDeSesion (sid) {
  const a = await makeEphemeral(); const b = await makeEphemeral()
  return deriveKey(a.privateKey, b.pub, sid)
}

function cliente () {
  const c = new RemoteAgentClient({ id: { me: {} } }, { agentPubkey: 'agente' })
  c.sid = 'viejo'
  c.key = 'llave-vieja'
  c.saludos = 0
  c._handshake = async function () {
    this.saludos++
    await new Promise((r) => setTimeout(r, 10))
    this.sid = 'nuevo-' + this.saludos
    this.key = await llaveDeSesion(this.sid)
  }
  c.eventos = []
  c.on('resumed', (e) => c.eventos.push(['resumed', e.sid]))
  c.on('error', (e) => c.eventos.push(['error', e.code || e.message]))
  return c
}

test('«unknown-session» de MI sesión: vuelve a saludar y avisa con resumed', async () => {
  const c = cliente()
  c._onAgentError({ code: 'unknown-session', sid: 'viejo', error: 'sesión desconocida o expirada' })
  await c._resuming
  assert.equal(c.saludos, 1)
  assert.equal(c.sid, 'nuevo-1')
  assert.deepEqual(c.eventos, [['resumed', 'nuevo-1']])
})

test('varios seguidos (cada tecla que llegó tarde) saludan UNA vez', async () => {
  const c = cliente()
  for (let i = 0; i < 5; i++) c._onAgentError({ code: 'unknown-session', sid: 'viejo' })
  await c._resuming
  assert.equal(c.saludos, 1)
  assert.deepEqual(c.eventos, [['resumed', 'nuevo-1']])
})

test('el de un sid que ya no es el mío (llegó después de volver a saludar) se ignora', async () => {
  const c = cliente()
  c._onAgentError({ code: 'unknown-session', sid: 'viejo' })
  await c._resuming
  c._onAgentError({ code: 'unknown-session', sid: 'viejo' })
  assert.equal(c._resuming, null)
  assert.equal(c.saludos, 1)
})

test('lo que se manda mientras tanto sale DESPUÉS, con la sesión nueva', async () => {
  const c = cliente()
  const enviados = []
  c.client = { sendByPubkey: (_to, msg) => enviados.push(msg.sid) }
  c._onAgentError({ code: 'unknown-session', sid: 'viejo' })
  await c.send({ type: 'input', data: 'ls\n' }).catch((e) => enviados.push('falló: ' + e.message))
  assert.deepEqual(enviados.filter((x) => !String(x).startsWith('falló')), ['nuevo-1'])
})

test('si no puede volver a saludar, lo dice por error', async () => {
  const c = cliente()
  c._handshake = async () => { throw Object.assign(new Error('el agente no respondió'), { code: 'no-reply' }) }
  c._onAgentError({ code: 'unknown-session', sid: 'viejo' })
  await c._resuming
  assert.deepEqual(c.eventos, [['error', 'no-reply']])
  await assert.rejects(c.send({ type: 'input', data: 'x' }), { code: 'no-session' })
})

test('cualquier otro error del agente sale por error, con su código, y no saluda', async () => {
  const c = cliente()
  c._onAgentError({ code: 'otra-cosa', error: 'algo' })
  assert.equal(c.saludos, 0)
  assert.deepEqual(c.eventos, [['error', 'otra-cosa']])
})

// SIEMPRE EL CAMINO MÁS DIRECTO: con el token del agente se manda por token (lo único que
// sube a WebRTC); sin él, por su pubkey.
test('con el token del agente se manda por token, y sin él por pubkey', async () => {
  const c = cliente()
  const porToken = []; const porPubkey = []
  c.client = {
    sendToOrQueue: (t, msg, o) => porToken.push([t, msg.type, o.peerPubkey]),
    sendByPubkey: (pk, msg) => porPubkey.push([pk, msg.type])
  }
  c.key = await (await import('../e2e.js')).deriveKey(
    (await (await import('../e2e.js')).makeEphemeral()).privateKey,
    (await (await import('../e2e.js')).makeEphemeral()).pub, 'sid')
  c.sid = 'sid'
  await c.send({ type: 'input', data: 'a' })
  c.agentToken = 'TOK'
  await c.send({ type: 'input', data: 'b' })
  assert.equal(porPubkey.length, 1)
  assert.deepEqual(porToken, [['TOK', 'ra.data', c.agentPubkey]])
})
