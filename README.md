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
- **Renovación automática del cert** (`vault.renew`): el cert dura 30 días y el agente
  pide uno fresco cuando le quedan menos de 7, en el mismo tic que el refresco de
  revocados. Sin esto, una máquina que nunca dejó de ser tuya se caía sola al mes y
  había que re-emparejarla a mano. El cert nuevo se verifica antes de guardarlo (misma
  maestra, misma sub-clave, más vida); si la bóveda está apagada, el siguiente tic
  reintenta, con días de margen. Un cert **ya vencido** no se renueva: ahí sí toca
  re-emparejar.
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
| `@dotrino/remote-agent/link` | Node | `enroll`, `loadLink`, `saveLink`, `dataDir`, `parseQr`, `identityFromLink`, `clientLink` |
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
// ra.client → el WebSocketProxyClient ya conectado e identificado bajo esta
//   máquina. Si tu agente necesita algo más del transporte (anunciarse en un
//   canal, por ejemplo), REUSA este: abrir una segunda conexión sería un segundo
//   `identify`, una segunda identidad de transporte y una segunda cola.
```

Enrolar la máquina (una vez, con la invitación del vault — URL del QR, código compacto
o JSON, da igual: la entiende `enrollWithVault` de `@dotrino/vault`, que es el único
enrolamiento headless del ecosistema y el que esto reusa):

```js
import { enroll } from '@dotrino/remote-agent/link'
const link = await enroll({
  qr, label: 'ia-agent',
  onChallenge: ({ deviceId, code }) => console.log(`Escribe en el vault: dotrino-vault approve ${code}`)
})
// link = { device, enc, cert, iss, proxy, label, ns?, at } — `enc` es la llave de
// CIFRADO: con ella la bóveda puede sellarle secretos a este agente.
```

**Lo que puede hacer el agente lo dice la invitación, no este paquete**: no hay tipos
de agente, hay permisos (`dotrino-vault pair --scope sign,read,store,secrets:<ns>`). Un
bot que publica en las apps y lee solo su cajón de secretos se empareja con
`pair --service <ns> --scope sign`, y se enrola con `enroll({ qr, ns: '<ns>' })` (el `ns`
hace que se exija ese permiso en el cert y queda en el enlace). Sus secretos los pide
con `fetchSecrets`/`waitForSecrets` de `@dotrino/vault/service` pasando la identidad por
parámetros (`{ ns, proxyUrl: link.proxy, masterPubkey: link.iss, device, cert, enc }`).

### Un agente como CLIENTE de otro agente (Node)

Un agente Node también puede hablar con otro agente —un bot que guarda en el node de
contenido, por ejemplo— con el mismo código que usa una app: `clientLink(link)` arma el
`{ id, cert, iss, proxy }` que esperan `RemoteAgentClient` y `ContentClient`, con un `id`
que firma con la llave del aparato (`identityFromLink`).

```js
import { loadLink, clientLink } from '@dotrino/remote-agent/link'
import { ContentClient } from '@dotrino/content-client'
const cc = await ContentClient.connect({ link: clientLink(loadLink()) })
const ref = await cc.put(bytes, { encrypt: false, acl: 'public', mime: 'application/json' })
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
- `@dotrino/vault` (`enrollWithVault`: el enrolamiento headless del ecosistema; `parseInvite`)
- `ws` (shim de `WebSocket` en Node, lado agente)

## Licencia

MIT.
