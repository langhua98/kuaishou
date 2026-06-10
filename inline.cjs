const fs = require('fs')

let html = fs.readFileSync('index.html', 'utf8')

if (!html.includes('<!-- GAME_SCRIPT_PLACEHOLDER -->')) {
  console.error('ERROR: placeholder not found in index.html')
  process.exit(1)
}

let js = fs.readFileSync('src/main.js', 'utf8')
js = js.replace(/<\/script/gi, '<\\/script')

html = html.replace('<!-- GAME_SCRIPT_PLACEHOLDER -->', '<script>\n' + js + '\n</script>')

fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/index.html', html)

var srcKB = (Buffer.byteLength(js, 'utf8') / 1024).toFixed(1)
console.log('Done. src/main.js=' + srcKB + 'KB, Final HTML=' + (fs.statSync('dist/index.html').size/1024).toFixed(1) + 'KB')
