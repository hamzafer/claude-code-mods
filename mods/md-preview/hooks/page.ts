// The page Chrome draws: the rendered Markdown in GitHub's dark look.
import { esc, MARK } from './md'

// GitHub's dark theme, trimmed to what a README uses.
const CSS = `
:root{color-scheme:dark}
html,body{margin:0;background:#0d1117}
body{color:#f0f6fc;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji";word-wrap:break-word}
.markdown-body{box-sizing:border-box;padding:20px 28px 32px}
.markdown-body>*:first-child{margin-top:0!important}
a{color:#4493f8;text-decoration:none}
a:hover{text-decoration:underline}
p,blockquote,ul,ol,dl,table,pre,details{margin-top:0;margin-bottom:16px}
h1,h2,h3,h4,h5,h6{margin-top:24px;margin-bottom:16px;font-weight:600;line-height:1.25}
h1{font-size:2em;padding-bottom:.3em;border-bottom:1px solid #3d444db3}
h2{font-size:1.5em;padding-bottom:.3em;border-bottom:1px solid #3d444db3}
h3{font-size:1.25em}h4{font-size:1em}h5{font-size:.875em}h6{font-size:.85em;color:#9198a1}
.markdown-heading{position:relative}
.markdown-heading .anchor{display:none}
strong{font-weight:600}
hr{height:.25em;padding:0;margin:24px 0;background:#3d444d;border:0}
blockquote{margin-left:0;margin-right:0;padding:0 1em;color:#9198a1;border-left:.25em solid #3d444d}
blockquote>:last-child{margin-bottom:0}
ul,ol{padding-left:2em}
ul ul,ul ol,ol ol,ol ul{margin-top:0;margin-bottom:0}
li+li{margin-top:.25em}
li>p{margin-top:16px}
.contains-task-list{list-style:none;padding-left:0}
.contains-task-list .contains-task-list{padding-left:2em}
.task-list-item-checkbox{margin:0 .2em .25em -1.4em;vertical-align:middle}
.contains-task-list>.task-list-item{padding-left:1.6em}
code,tt{padding:.2em .4em;margin:0;font-size:85%;white-space:break-spaces;background:#656c7633;border-radius:6px;font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
pre{padding:16px;overflow:hidden;font-size:85%;line-height:1.45;color:#f0f6fc;background:#151b23;border-radius:6px;font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace}
pre code{display:inline;padding:0;margin:0;font-size:100%;white-space:pre-wrap;background:transparent;border:0}
.highlight pre{margin-bottom:0}
.highlight{margin-bottom:16px}
markdown-accessiblity-table{display:block}
table{display:block;width:max-content;max-width:100%;overflow:hidden;border-spacing:0;border-collapse:collapse}
table th{font-weight:600}
table th,table td{padding:6px 13px;border:1px solid #3d444d}
table tr{background:#0d1117;border-top:1px solid #3d444db3}
table tr:nth-child(2n){background:#151b23}
img{max-width:100%;box-sizing:content-box}
kbd{display:inline-block;padding:3px 5px;font:11px ui-monospace,monospace;line-height:10px;color:#f0f6fc;vertical-align:middle;background:#151b23;border:solid 1px #3d444db3;border-bottom-color:#3d444db3;border-radius:6px;box-shadow:inset 0 -1px 0 #3d444db3}
details summary{cursor:pointer}
.label{padding:14px 28px 0;color:#9198a1;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.md-mark{display:none}
.md-mark+*{position:relative}
.md-mark+*::after{content:'';position:absolute;left:-18px;top:0;bottom:0;width:4px;border-radius:2px;background:#3fb950}
.pl-k{color:#ff7b72}.pl-s,.pl-pds,.pl-s .pl-pse .pl-s1{color:#a5d6ff}.pl-c{color:#9198a1}.pl-c1,.pl-v{color:#79c0ff}.pl-en,.pl-e{color:#d2a8ff}.pl-smi,.pl-s1{color:#f0f6fc}.pl-ent{color:#7ee787}
`

// The MARK paragraph, as GitHub or the built-in renderer wrote it, becomes the marker.
export function markers(html: string) {
  return html.replace(new RegExp(`<p[^>]*>\\s*${MARK}\\s*</p>`, 'g'), '<div class="md-mark"></div>')
}

// A path as a file:// URL, each segment encoded (# and ? included).
export function fileUrl(path: string) {
  return `file://${path.split('/').map(encodeURIComponent).join('/')}`
}

// Relative links and images point at the Markdown file's folder, as file:// URLs.
// Only attributes inside tags change: code that shows `href="x"` stays as written.
export function absolute(html: string, dir: string) {
  const root = fileUrl(dir.replace(/\/?$/, '/'))
  const fix = (url: string) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url) || url === '') return url
    if (url.startsWith('/')) return `file://${url}`
    return `${root}${url.replace(/^\.\//, '')}`
  }
  return html.replace(/<[a-z][^>]*>/gi, tag =>
    tag
      .replace(/(\s(?:src|href)\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (_m, pre: string, dq?: string, sq?: string) => `${pre}"${fix(dq ?? sq ?? '')}"`)
      .replace(/(\ssrcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (_m, pre: string, dq?: string, sq?: string) =>
        `${pre}"${(dq ?? sq ?? '').split(',').map(c => c.trim().replace(/^\S+/, u => fix(u))).join(', ')}"`),
  )
}

export type Side = { label?: string; html: string; dir: string }

/**
 * A whole page: one rendered file, or several side by side (stacked when narrow),
 * each under its label. `width` 0 is the browser's page: centered, any width.
 * On load it writes its height into the body, for `--dump-dom` to read back; a
 * `#<px>` in the URL shifts it up, so a tall page is drawn in parts.
 */
export function page(sides: readonly Side[], opts: { title: string; width: number; stacked?: boolean }) {
  const many = sides.length > 1
  const cols = sides
    .map(s => `<section class="col">${s.label ? `<div class="label">${esc(s.label)}</div>` : ''}<article class="markdown-body">\n${absolute(markers(s.html), s.dir)}\n</article></section>`)
    .join('\n')
  const size = opts.width > 0 ? `body{width:${opts.width}px}` : `body{max-width:${many && !opts.stacked ? 2000 : 1012}px;margin:0 auto}`
  const grid = many && !opts.stacked ? `.cols{display:grid;grid-template-columns:repeat(${sides.length},minmax(0,1fr))}.col+.col{border-left:1px solid #3d444d}` : '.col+.col{border-top:1px solid #3d444d}'
  // Nothing in the Markdown may run: the page's own script alone, by its nonce.
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('')
  const csp = `default-src 'none'; img-src * data: file:; media-src * file:; style-src 'unsafe-inline'; font-src * data: file:; script-src 'nonce-${nonce}'`
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${esc(opts.title)}</title>
<style>${CSS}${size}${grid}</style></head>
<body><main class="page"><div class="cols">
${cols}
</div></main>
<script nonce="${nonce}">if(location.hash.length>1){document.querySelector('.page').style.transform='translateY(-'+parseInt(location.hash.slice(1),10)+'px)'}
addEventListener('load',function(){document.body.setAttribute('data-height',String(Math.ceil(document.querySelector('.page').getBoundingClientRect().height)))})</script>
</body></html>
`
}
