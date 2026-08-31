/**
 * @dotrino/remote-agent — middleware compartido para apps de agente remoto
 * cifrado punto a punto del ecosistema Dotrino.
 *
 * Entry points (subpath exports en package.json):
 *   '@dotrino/remote-agent'          → e2e + constantes de protocolo (isomórfico)
 *   '@dotrino/remote-agent/agent'    → startRemoteAgent() (Node, lado del agente)
 *   '@dotrino/remote-agent/client'   → RemoteAgentClient (navegador, lado PWA)
 *   '@dotrino/remote-agent/link'     → enroll() emparejamiento SAS (Node)
 *   '@dotrino/remote-agent/discover' → listAgentsByLabel() (navegador)
 *   '@dotrino/remote-agent/node-globals' → installNodeGlobals() (Node)
 *
 * El paquete NO sabe nada de PTY ni de IA: provee canal cifrado por sesión,
 * despacho de payloads de dominio, emparejamiento con vault y revocación.
 */
export * from './e2e.js'
export * from './protocol.js'
