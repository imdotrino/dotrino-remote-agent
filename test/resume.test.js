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
async function sessionKey (sid) {
  const a = await makeEphemeral(); const b = await makeEphemeral()
  return deriveKey(a.privateKey, b.pub, sid)
}

function makeClient () {
  const c = new RemoteAgentClient({ id: { me: {} } }, { agentPubkey: 'agente' })
  c.sid = 'old'
  c.key = 'llave-vieja'
  c.greetings = 0
  c._handshake = async function () {
    this.greetings++
    await new Promise((r) => setTimeout(r, 10))
    this.sid = 'new-' + this.greetings
    this.key = await sessionKey(this.sid)
  }
  c.events = []
  c.on('resumed', (e) => c.events.push(['resumed', e.sid]))
  c.on('error', (e) => c.events.push(['error', e.code || e.message]))
  return c
}

test('«unknown-session» de MI sesión: vuelve a saludar y avisa con resumed', async () => {
  const c = makeClient()
  c._onAgentError({ code: 'unknown-session', sid: 'old', error: 'unknown or expired session' })
  await c._resuming
  assert.equal(c.greetings, 1)
  assert.equal(c.sid, 'new-1')
  assert.deepEqual(c.events, [['resumed', 'new-1']])
})

test('varios seguidos (cada tecla que llegó tarde) saludan UNA vez', async () => {
  const c = makeClient()
  for (let i = 0; i < 5; i++) c._onAgentError({ code: 'unknown-session', sid: 'old' })
  await c._resuming
  assert.equal(c.greetings, 1)
  assert.deepEqual(c.events, [['resumed', 'new-1']])
})

test('el de un sid que ya no es el mío (llegó después de volver a saludar) se ignora', async () => {
  const c = makeClient()
  c._onAgentError({ code: 'unknown-session', sid: 'old' })
  await c._resuming
  c._onAgentError({ code: 'unknown-session', sid: 'old' })
  assert.equal(c._resuming, null)
  assert.equal(c.greetings, 1)
})

test('lo que se manda mientras tanto sale DESPUÉS, con la sesión nueva', async () => {
  const c = makeClient()
  const sent = []
  c.client = { sendByPubkey: (_to, msg) => sent.push(msg.sid) }
  c._onAgentError({ code: 'unknown-session', sid: 'old' })
  await c.send({ type: 'input', data: 'ls\n' }).catch((e) => sent.push('falló: ' + e.message))
  assert.deepEqual(sent.filter((x) => !String(x).startsWith('falló')), ['new-1'])
})

test('si no puede volver a saludar, lo dice por error', async () => {
  const c = makeClient()
  c._handshake = async () => { throw Object.assign(new Error('the agent did not reply'), { code: 'no-reply' }) }
  c._onAgentError({ code: 'unknown-session', sid: 'old' })
  await c._resuming
  assert.deepEqual(c.events, [['error', 'no-reply']])
  await assert.rejects(c.send({ type: 'input', data: 'x' }), { code: 'no-session' })
})

test('cualquier otro error del agente sale por error, con su código, y no saluda', async () => {
  const c = makeClient()
  c._onAgentError({ code: 'otra-cosa', error: 'algo' })
  assert.equal(c.greetings, 0)
  assert.deepEqual(c.events, [['error', 'otra-cosa']])
})

// SIEMPRE EL CAMINO MÁS DIRECTO: con el token del agente se manda por token (lo único que
// sube a WebRTC); sin él, por su pubkey.
test('con el token del agente se manda por token, y sin él por pubkey', async () => {
  const c = makeClient()
  const byToken = []; const byPubkey = []
  c.client = {
    sendToOrQueue: (t, msg, o) => byToken.push([t, msg.type, o.peerPubkey]),
    sendByPubkey: (pk, msg) => byPubkey.push([pk, msg.type])
  }
  c.key = await (await import('../e2e.js')).deriveKey(
    (await (await import('../e2e.js')).makeEphemeral()).privateKey,
    (await (await import('../e2e.js')).makeEphemeral()).pub, 'sid')
  c.sid = 'sid'
  await c.send({ type: 'input', data: 'a' })
  c.agentToken = 'TOK'
  await c.send({ type: 'input', data: 'b' })
  assert.equal(byPubkey.length, 1)
  assert.deepEqual(byToken, [['TOK', 'ra.data', c.agentPubkey]])
})
