'use strict';
// Utilidades HTTP: respuestas JSON (con gzip), archivos estáticos y cabeceras de seguridad.
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8' };

const wantsGzip = res => /\bgzip\b/.test(String(res.req && res.req.headers['accept-encoding'] || ''));

function json(res, code, body) {
  const raw = Buffer.from(JSON.stringify(body));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60', Vary: 'Accept-Encoding' };
  if (raw.length > 1024 && wantsGzip(res)) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(code, headers);
    return res.end(zlib.gzipSync(raw)); // las respuestas grandes (la ficha de un comandante pesa cientos de KB) bajan a una fracción
  }
  res.writeHead(code, headers);
  res.end(raw);
}

// Archivos estáticos: se leen una vez (y se comprimen) mientras no cambien en disco.
const staticCache = new Map();
function serveStatic(res, file) {
  const mtime = fs.statSync(file).mtimeMs;
  let e = staticCache.get(file);
  if (!e || e.mtime !== mtime) {
    const raw = fs.readFileSync(file);
    e = { mtime, raw, gz: /\.(html|js|css|svg|webmanifest)$/.test(file) ? zlib.gzipSync(raw) : null };
    staticCache.set(file, e);
  }
  const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' };
  if (e.gz && wantsGzip(res)) { headers['Content-Encoding'] = 'gzip'; res.writeHead(200, headers); return res.end(e.gz); }
  res.writeHead(200, headers); res.end(e.raw);
}

// La web no usa scripts ni manejadores en línea (los estilos en línea sí), y solo habla con este servidor y con
// Scryfall (imágenes y tipos de carta, desde el navegador).
const SECURITY_HEADERS = {
  'Content-Security-Policy': ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://api.scryfall.com https://*.scryfall.io", "connect-src 'self' https://api.scryfall.com",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// Un error inesperado en una petición no debe tumbar el servidor: se responde 500 y se sigue.
function fail(res, e) {
  console.error('Error en la petición:', e && e.stack || e);
  if (!res.headersSent) { try { json(res, 500, { error: 'Error interno' }); } catch { res.destroy(); } } else res.end();
}

module.exports = { json, serveStatic, SECURITY_HEADERS, fail };
