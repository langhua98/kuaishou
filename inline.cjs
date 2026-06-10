const fs = require('fs')

// Read source HTML directly — bypasses any Vite transformations
let html = fs.readFileSync('index.html', 'utf8')

// Remove ALL external <script src="..."> tags (dev entry, module references, etc.)
html = html.replace(/<script[^>]+src="[^"]+"[^>]*>\s*<\/script>\s*/gi, '')

// Inject raw src/main.js as a plain inline script
let js = fs.readFileSync('src/main.js', 'utf8')
js = js.replace(/<\/script/gi, '<\\/script')

const srcKB = (Buffer.byteLength(js, 'utf8') / 1024).toFixed(1)
html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>')

fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/index.html', html)
console.log('Done. src/main.js=' + srcKB + 'KB, Final HTML=' + (fs.statSync('dist/index.html').size/1024).toFixed(1) + 'KB')
