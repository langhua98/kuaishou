const fs = require('fs')
const path = require('path')

const assetsDir = 'dist/assets'
const jsFile = fs.readdirSync(assetsDir).find(f => f.startsWith('index-') && f.endsWith('.js'))
if (!jsFile) { console.error('No JS bundle found in dist/assets'); process.exit(1) }

const jsPath = path.join(assetsDir, jsFile)
console.log('Inlining:', jsFile, '(' + (fs.statSync(jsPath).size / 1024).toFixed(1) + 'KB)')

let js = fs.readFileSync(jsPath, 'utf8')
// Must escape </script to prevent HTML parser from closing the tag early
js = js.replace(/<\/script/gi, '<\\/script')

let html = fs.readFileSync('dist/index.html', 'utf8')
const before = html

// Remove the external <script> tag produced by Vite
html = html.replace(/<script[^>]+src="[^"]*assets\/index-[^"]+"[^>]*>\s*<\/script>\s*/g, '')
if (html === before) { console.error('Could not find script tag to remove'); process.exit(1) }

// Store JS in a non-executed text/plain tag, then load via Blob URL.
// This bypasses WKWebView's silent skip of large inline <script> blocks.
const store = '<script type="text/plain" id="_jb">\n' + js + '\n</script>\n'
const bootstrap = `<script>
(function(){
  try {
    var src = document.getElementById('_jb').textContent;
    var blob = new Blob([src], {type:'application/javascript'});
    var url = URL.createObjectURL(blob);
    var el = document.createElement('script');
    el.onerror = function(e) {
      var t = document.getElementById('loading-text');
      var f = document.getElementById('loading-fill');
      if(t) t.textContent = 'Blob加载失败';
      if(f) { f.style.width='100%'; f.style.background='#f44'; }
    };
    el.src = url;
    document.body.appendChild(el);
  } catch(e) {
    var t = document.getElementById('loading-text');
    var f = document.getElementById('loading-fill');
    if(t) t.textContent = 'Bootstrap错误: ' + (e.message||'?');
    if(f) { f.style.width='100%'; f.style.background='#f44'; }
  }
})();
</script>\n`

html = html.replace('</body>', store + bootstrap + '</body>')

fs.writeFileSync('dist/index.html', html)
console.log('Done. Final HTML:', (fs.statSync('dist/index.html').size / 1024).toFixed(1) + 'KB')
