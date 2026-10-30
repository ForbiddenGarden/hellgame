'use strict';
// Emulates the Vercel deployment locally (static files + rewrites + serverless handler, in-memory store).
//   HOST_KEY=hellgame node tools/vercel-local.js     # http://localhost:3777
const http = require('http');
const fs = require('fs');
const path = require('path');
const { makeHandler } = require('../lib/handler');
const { defaultStore } = require('../lib/store');
const content = require('../content/game.json');

const PUBLIC = path.join(__dirname, '..', 'public');
const handler = makeHandler({ store: defaultStore(), content, hostKey: process.env.HOST_KEY });
const REWRITE = { '/': 'play.html', '/board': 'board.html', '/host': 'host.html' };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks).toString();
    req.body = raw ? JSON.parse(raw) : undefined;
    req.query = { p: url.pathname.slice(5) };
    return handler(req, res);
  }
  const file = path.join(PUBLIC, REWRITE[url.pathname] || url.pathname);
  fs.readFile(file, (e, d) => { if (e) { res.statusCode = 404; return res.end('404'); } res.setHeader('Content-Type', TYPES[path.extname(file)] || 'text/plain'); res.end(d); });
}).listen(3777, () => console.log('vercel-local on :3777'));
