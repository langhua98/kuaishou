// Build: inject src/main.js into template.html → index.html (committed to main).
// GitHub Pages serves the main branch root directly, so index.html IS the deployed page.
const fs = require('fs')

let html = fs.readFileSync('template.html', 'utf8')

if (!html.includes('// GAME_JS_PLACEHOLDER')) {
  console.error('ERROR: placeholder not found in template.html')
  process.exit(1)
}

let js = fs.readFileSync('src/main.js', 'utf8')
js = js.replace(/<\/script/gi, '<\\/script')

html = html.replace('// GAME_JS_PLACEHOLDER', js)

fs.writeFileSync('index.html', html)

var srcKB = (Buffer.byteLength(js, 'utf8') / 1024).toFixed(1)
console.log('Done. src/main.js=' + srcKB + 'KB, index.html=' + (fs.statSync('index.html').size / 1024).toFixed(1) + 'KB')
