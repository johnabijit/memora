import { build } from 'esbuild'
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'

// Only these public assets go to Pages. Server code and tests are never assets.
await rm('dist', { recursive: true, force: true })
await mkdir('dist/assets', { recursive: true })
const bundle = await build({
  entryPoints: ['app.js'], bundle: true, format: 'esm', platform: 'browser',
  target: ['es2022'], minify: true, write: false, legalComments: 'eof'
})
const js = bundle.outputFiles[0].contents
const css = await readFile('styles.css')
const hash = data => createHash('sha256').update(data).digest('hex').slice(0, 12)
const jsPath = `assets/app.${hash(js)}.js`
const cssPath = `assets/styles.${hash(css)}.css`
await writeFile(`dist/${jsPath}`, js)
await writeFile(`dist/${cssPath}`, css)
const html = (await readFile('index.html', 'utf8'))
  .replace('app.js?v=43.1', jsPath).replace('styles.css?v=43.1', cssPath)
await writeFile('dist/index.html', html)
for (const file of ['icon.svg', 'manifest.webmanifest', '_headers']) await copyFile(file, `dist/${file}`)
const sw = (await readFile('service-worker.js', 'utf8'))
  .replace("'./styles.css?v=43.1'", `'./${cssPath}'`)
  .replace("'./app.js?v=43.1'", `'./${jsPath}'`)
await writeFile('dist/service-worker.js', sw)
await writeFile('dist/_routes.json', JSON.stringify({ version: 1, include: ['/api', '/api/*'], exclude: [] }))
console.log(`Built Memora 43.1: ${jsPath}, ${cssPath}`)
