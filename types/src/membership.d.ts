/** @typedef {import('./shapes.js').DotrinoActa} DotrinoActa */
/**
 * @param {DotrinoActa | null | undefined} acta
 * @param {unknown} pub
 * @returns {boolean}
 */
export function canGreet(acta: DotrinoActa | null | undefined, pub: unknown): boolean;
/**
 * Los permisos de PRODUCTO que le faltan a ese aparato (`terminal`, `desktop`…): los que el
 * agente declara en `needs`, además de `sign` (dueño, 2026-11-16, tras la auditoría: con solo
 * `sign`, cualquier aparato del acta —un bot, un navegador prestado— abría una consola o el
 * escritorio en todas las máquinas). Sin acta faltan todos: no hay con qué decir que sí.
 * @param {DotrinoActa | null | undefined} acta
 * @param {unknown} pub
 * @param {readonly string[]} needs
 * @returns {string[]}
 */
export function missingCaps(acta: DotrinoActa | null | undefined, pub: unknown, needs: readonly string[]): string[];
declare namespace _default {
    export { canGreet };
    export { missingCaps };
}
export default _default;
export type DotrinoActa = import("./shapes.js").DotrinoActa;
