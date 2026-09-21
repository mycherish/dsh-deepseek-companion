/** Aliased in place of `node:url` for the browser bundle (Phase 07E). */
import { urlShim } from './node-builtins.ts'

export const fileURLToPath = urlShim.fileURLToPath
export const pathToFileURL = urlShim.pathToFileURL
export default urlShim
