// Minimal static server for design mockups in public/mockups.
// Used by the "mockups" entry in .claude/launch.json — not part of the app.
const http = require('http')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', 'public', 'mockups')
const port = parseInt(process.env.PORT || '5713', 10)
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' }

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0])
  let filePath = path.normalize(path.join(root, urlPath === '/' ? 'index.html' : urlPath))
  if (!filePath.startsWith(root)) { res.writeHead(403); return res.end('Forbidden') }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found') }
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' })
    res.end(data)
  })
}).listen(port, () => console.log(`mockups server on http://localhost:${port}`))
