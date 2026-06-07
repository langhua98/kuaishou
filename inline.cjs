// Inlines the built JS bundle into index.html as a <script> block at end of body.
// Inline scripts can't be blocked by content blockers or CORS policies.
// Must go at end of body (not head) because the bundle accesses DOM elements at module scope.
const fs = require('fs');
const path = require('path');

const assetsDir = 'dist/assets';
const jsFile = fs.readdirSync(assetsDir).find(f => f.startsWith('index-') && f.endsWith('.js'));
if (!jsFile) { console.error('No JS file found in dist/assets'); process.exit(1); }

const jsPath = path.join(assetsDir, jsFile);
console.log('Inlining:', jsFile, '(' + (fs.statSync(jsPath).size / 1024).toFixed(1) + 'KB)');

let js = fs.readFileSync(jsPath, 'utf8');
// Escape </script> so the HTML parser doesn't end the script block early
js = js.replace(/<\/script>/gi, '<\\/script>');

let html = fs.readFileSync('dist/index.html', 'utf8');

// Step 1: Remove the external <script> tag (defer or module, anywhere in document)
const before = html;
html = html.replace(/<script[^>]+src="[^"]*assets\/index-[^"]+"[^>]*>\s*<\/script>\s*/g, '');

if (html === before) {
  console.error('Could not find external script tag to remove in dist/index.html');
  process.exit(1);
}

// Step 2: Insert inline bundle just before </body>
const inlineTag = '<script>\n' + js + '\n</script>\n';
if (!html.includes('</body>')) {
  console.error('No </body> found in dist/index.html');
  process.exit(1);
}
html = html.replace('</body>', inlineTag + '</body>');

fs.writeFileSync('dist/index.html', html);
const finalSize = fs.statSync('dist/index.html').size;
console.log('Done. Final HTML:', (finalSize / 1024).toFixed(1) + 'KB');
