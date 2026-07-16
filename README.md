# @dotrino/remote-agent

Middleware compartido del ecosistema Dotrino para **apps de agente remoto cifrado
punto a punto**. Lo consumen [`dotrino-terminal`](https://github.com/imdotrino/dotrino-terminal)
(PTY remoto) y [`dotrino-ia`](https://github.com/imdotrino/dotrino-ia) (chat con
agentes de IA), y cualquier app futura que necesite hablar con un proceso que corre
en la máquina del usuario.

Provee lo común — y **solo** eso:

- **Canal cifrado E2E por sesión** (ECDH P-256 → HKDF → AES-256-GCM, isomórfico WebCrypto).
- **Handshake anti-MITM** con `verifyChain` + anti-replay (firmado por el vault).
- **Emparejamiento SAS** del agente contra el vault (código que no viaja).
- **Revocación** con auto-borrado del enlace al ser revocada la máquina.
- **Wiring de proxy + identity** (`identify` firmado, transporte por `proxy.dotrino.com`).
- **Autodescubrimiento** de agentes por label (`listVaultDevices` + filtro).
- **Auditoría** (`sessions.log` JSONL).

**No sabe nada de PTY ni de IA.** Cada app define sus payloads de dominio
(terminal pasa `{type:'cmd',...}`, ia pasa `{type:'msg',...}`) y su renderer.

## Entry points (subpath exports)

| Import | Entorno | Qué da |
|---|---|---|
| `@dotrino/remote-agent` | isomórfico | `e2e` (`makeEphemeral`/`deriveKey`/`seal`/`open`) + constantes de protocolo |
| `@dotrino/remote-agent/agent` | Node | `startRemoteAgent(opts)` |
| `@dotrino/remote-agent/client` | navegador | `RemoteAgentClient` |
| `@dotrino/remote-agent/link` | Node | `enroll`, `loadLink`, `dataDir`, `parseQr` |
| `@dotrino/remote-agent/discover` | navegador | `listAgentsByLabel` |

## Uso

### Agente (Node, en tu PC)

```js
import { startRemoteAgent } from '@dotrino/remote-agent/agent'

const ra = await startRemoteAgent({
  label: 'ia-agent',
  proxyUrl: 'wss://proxy.dotrino.com',   // opcional
  dir: '/home/yo/.local/share/dotrino-ia-agent', // opcional
  quiet: false,
  onSession (session) {
    // sesión cifrada con un dispositivo cliente. session.device = su pubkey.
    session.on('message', async (msg) => {
      // msg es un payload de dominio: la app define la forma
      if (msg.type === 'msg') {
        const reply = await runYourDriver(msg.text) // Claude / OpenCode / ...
        session.send({ type: 'done', text: reply })
      }
    })
    session.on('close', () => {})
  },
  onRevoked () { console.log('me revocaron') }
})
// ra.machine, ra.machineId, ra.master, ra.close()
```

Enrolar la máquina (una vez, con el QR del vault):

```js
import { enroll } from '@dotrino/remote-agent/link'
const link = await enroll({
  qr, label: 'ia-agent',
  onChallenge: ({ deviceId, code }) => console.log(`Tipeá en el vault: ${code}`)
})
```

### Cliente (navegador, la PWA)

```js
import { RemoteAgentClient } from '@dotrino/remote-agent/client'
import { listAgentsByLabel } from '@dotrino/remote-agent/discover'

const agentes = await listAgentsByLabel(id, 'ia-agent')   // tarjetas en la UI
const chat = new RemoteAgentClient(link, { agentPubkey: agentes[0].sub })
await chat.connect()                                        // handshake E2E
chat.on('message', (payload) => render(payload))
chat.on('error', (e) => console.warn(e))
chat.send({ type: 'msg', text: 'arreglá el bug en auth.js' })

const online = await chat.ping()  // liveness sin abrir sesión
```

### `link` (la PWA lo obtiene del vault)

Ver `dotrino-terminal/src/vault.js` (`getLink` / `getSelfLink`) como referencia: es
el enlace del dispositivo (cert `P ← maestra`, `iss`, `proxy`), que se pasa al
`RemoteAgentClient`. La terminal ya lo resuelve; cada app puede copiar ese patrón o
extraerlo luego a este paquete.

## Seguridad

- **Autorización = estar vinculado al vault.** El agente solo atiende dispositivos
  cuya cadena certifica la maestra pineada (`verifyChain` con `trustedIssuer`).
- **Emparejamiento con código SAS** que no viaja (anti aprobación a ciegas / vault impostor).
- **Anti-replay** en el handshake (`ts` ±5 min).
- **Auto-borrado** del `link.json` al recibir un `revoke` firmado por la maestra.
- **Auditoría** local de cada sesión abierta.
- El relay de transporte (`proxy.dotrino.com`) **solo ve bytes cifrados**.

## Dependencias

- `@dotrino/identity` (capabilities: `verifyChain`, `signWithDevice`, `verifyDeviceSig`,
  `pubkeyId`, `makeDeviceKey`, `verifyDelegation`, `makePairingCode`)
- `@dotrino/proxy-client` (`WebSocketProxyClient`)
- `ws` (shim de `WebSocket` en Node, lado agente)

## Licencia

MIT.
