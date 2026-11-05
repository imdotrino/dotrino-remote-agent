/** localStorage síncrono respaldado por un archivo JSON (solo lo que usan los paquetes). */
/**
 * @param {string} filePath
 * @returns {Storage}
 */
export function fileLocalStorage(filePath: string): Storage;
/** @param {string} dir  dónde vive `transport.json` (la llave de transporte del proxy-client) */
export function installNodeGlobals(dir: string): void;
