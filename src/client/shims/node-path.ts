/** Aliased in place of `node:path` for the browser bundle (Phase 07E). */
import { pathShim } from './node-builtins.ts'

export default pathShim
export const sep = pathShim.sep
export const join = pathShim.join
export const dirname = pathShim.dirname
export const basename = pathShim.basename
export const extname = pathShim.extname
