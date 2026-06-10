const fs = require('fs')

// Read Vite-generated HTML for structure (we discard the bundle it references)
let html = fs.readFileSync('dist/index.html', 'utf8')
const before = html

// Remove the Vite bundle script tag
html = html.replace(/<script[^>]+src="[^"]*assets\/index-[^"]+"[^>]*>\s*<\/script>\s*/g, '')
if (html === before) { console.error('Could not find script tag to remove'); process.exit(1) }

// Inject raw src/main.js directly — no IIFE wrapper, no bundler transforms
let js = fs.readFileSync('src/main.js', 'utf8')
js = js.replace(/<\/script/gi, '<\\/script')

const srcKB = (Buffer.byteLength(js, 'utf8') / 1024).toFixed(1)
html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>')

fs.writeFileSync('dist/index.html', html)
console.log('Inlined src/main.js (' + srcKB + 'KB). Final HTML:', (fs.statSync('dist/index.html').size / 1024).toFixed(1) + 'KB')
