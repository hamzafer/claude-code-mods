// The glyphs the rain is made of: half-width katakana, digits and a few symbols, set in
// whatever monospace face the system has. Nothing is loaded. No character here needs
// escaping in SVG text.

import type { Random } from './random.js'

const GLYPHS = 'ｦｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ0123456789:=+*.¦'

export const FONT = "ui-monospace,Menlo,Consolas,'DejaVu Sans Mono',monospace"

export function glyph(r: Random): string {
  return GLYPHS[Math.floor(r.next() * GLYPHS.length)]!
}
