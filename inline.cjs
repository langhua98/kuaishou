const fs = require('fs')

const assetsDir = 'dist/assets'
const jsFile = fs.readdirSync(assetsDir).find(f => f.startsWith('index-') && f.endsWith('.js'))
if (!jsFile) { console.error('No JS bundle found in dist/assets'); process.exit(1) }

const jsPath = assetsDir + '/' + jsFile
console.log('Inlining:', jsFile, '(' + (fs.statSync(jsPath).size / 1024).toFixed(1) + 'KB)')

let js = fs.readFileSync(jsPath, 'utf8')
// Escape </script so the HTML parser doesn't close the tag early
js = js.replace(/<\/script/gi, '<\\/script')

let html = fs.readFileSync('dist/index.html', 'utf8')
const before = html

// Remove the external <script> tag produced by Vite
html = html.replace(/<script[^>]+src="[^"]*assets\/index-[^"]+"[^>]*>\s*<\/script>\s*/g, '')
if (html === before) { console.error('Could not find script tag to remove'); process.exit(1) }

// Direct inline — bundle is ~12KB, safe for WKWebView
html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>')

fs.writeFileSync('dist/index.html', html)
console.log('Done. Final HTML:', (fs.statSync('dist/index.html').size / 1024).toFixed(1) + 'KB')
