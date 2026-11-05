/** @typedef {import('./shapes.js').DotrinoActa} DotrinoActa */
/**
 * @param {DotrinoActa | null | undefined} acta
 * @param {unknown} pub
 * @returns {boolean}
 */
export function canGreet(acta: DotrinoActa | null | undefined, pub: unknown): boolean;
declare namespace _default {
    export { canGreet };
}
export default _default;
export type DotrinoActa = import("./shapes.js").DotrinoActa;
