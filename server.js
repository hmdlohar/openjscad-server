'use strict';

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const WEB_ROOT = path.resolve(__dirname, 'web');
const MODELS_ROOT = path.resolve(__dirname, 'models');
const DEV_LIVE_RELOAD = process.env.DEV_LIVE_RELOAD === '1';
const LIVE_RELOAD_PATH = '/__live-reload';
const MAX_BODY_BYTES = 1024 * 1024;

const jscadModeling = require('@jscad/modeling');
const jscadStlSerializer = require('@jscad/stl-serializer');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.map': 'application/json; charset=utf-8'
};

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function injectLiveReload(html) {
  if (!DEV_LIVE_RELOAD) return html;
  const script = `
<script>
(() => {
  const es = new EventSource('${LIVE_RELOAD_PATH}');
  es.onmessage = (event) => {
    if (event.data === 'reload') location.reload();
  };
})();
</script>`;
  return html.includes('</body>') ? html.replace('</body>', `${script}\n</body>`) : `${html}\n${script}`;
}

function safePathFromUrl(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^([.][.][/\\])+/, '');
  return normalized;
}

function normalizeJscadResult(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flat(Infinity).filter(Boolean);
  return [value];
}

function createJscadApi() {
  const {
    booleans,
    colors,
    curves,
    extrusions,
    geometries,
    hulls,
    maths,
    measurements,
    primitives,
    text,
    transforms,
    utils
  } = jscadModeling;

  return {
    booleans,
    colors,
    curves,
    extrusions,
    geometries,
    hulls,
    maths,
    measurements,
    primitives,
    text,
    transforms,
    utils
  };
}

function evaluateJscadSource(sourceText) {
  const api = createJscadApi();
  const wrapped = `${sourceText}

if (typeof main === 'function') {
  return main()
}
`;
  const fn = new Function(...Object.keys(api), wrapped);
  return normalizeJscadResult(fn(...Object.values(api)));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8') || '{}';
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', (error) => reject(error));
  });
}

function parseTextBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;

    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', (error) => reject(error));
  });
}

function sanitizeStlFilename(inputName) {
  const base = String(inputName || 'model')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  const safe = base || 'model';
  return safe.toLowerCase().endsWith('.stl') ? safe : `${safe}.stl`;
}

function resolveModelPath(modelPath) {
  const relative = String(modelPath || '').trim();
  if (!relative) return null;

  const absolute = path.resolve(MODELS_ROOT, relative);
  if (!absolute.startsWith(MODELS_ROOT)) return null;
  return absolute;
}

async function walkModelFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkModelFiles(absolute)));
      continue;
    }

    if (entry.isFile() && /\.(js|jscad)$/i.test(entry.name)) {
      files.push(path.relative(MODELS_ROOT, absolute));
    }
  }

  return files;
}

async function resolvePath(urlPath) {
  const relative = safePathFromUrl(urlPath === '/' ? '/index.html' : urlPath);
  const absolute = path.resolve(WEB_ROOT, `.${relative.startsWith('/') ? relative : `/${relative}`}`);

  if (!absolute.startsWith(WEB_ROOT)) {
    return null;
  }

  try {
    const stats = await fsp.stat(absolute);
    if (stats.isDirectory()) {
      const indexPath = path.join(absolute, 'index.html');
      const indexStats = await fsp.stat(indexPath);
      if (indexStats.isFile()) return indexPath;
      return null;
    }

    if (stats.isFile()) return absolute;
    return null;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  try {
    if (req.method === 'GET' && req.url === '/api/model-files') {
      const files = await walkModelFiles(MODELS_ROOT).catch(() => []);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ files: files.sort() }));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/server-render') {
      const payload = await parseJsonBody(req);
      const modelPath = resolveModelPath(payload.filePath);

      if (!modelPath) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Invalid file path. Use paths under models/.' }));
        return;
      }

      const source = await fsp.readFile(modelPath, 'utf8');
      const solids = evaluateJscadSource(source);
      if (!solids.length) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Model returned no geometry.' }));
        return;
      }

      const { serialize } = jscadStlSerializer;
      const stlParts = serialize({ binary: false }, ...solids);
      const stlText = (Array.isArray(stlParts) ? stlParts.flat(Infinity) : [stlParts]).map(String).join('\n');

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(
        JSON.stringify({
          filePath: path.relative(MODELS_ROOT, modelPath),
          solidsCount: solids.length,
          stl: stlText
        })
      );
      return;
    }

    if (req.method === 'POST' && req.url === '/api/render-stl') {
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      let sourceCode = '';
      let outputName = 'model.stl';

      if (contentType.includes('application/json')) {
        const payload = await parseJsonBody(req);
        sourceCode = String(payload.code || '');
        outputName = sanitizeStlFilename(payload.filename || 'model.stl');
      } else {
        sourceCode = await parseTextBody(req);
        outputName = sanitizeStlFilename('model.stl');
      }

      if (!sourceCode.trim()) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Missing JSCAD source code.' }));
        return;
      }

      const solids = evaluateJscadSource(sourceCode);
      if (!solids.length) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Model returned no geometry.' }));
        return;
      }

      const { serialize } = jscadStlSerializer;
      const stlParts = serialize({ binary: false }, ...solids);
      const stlText = (Array.isArray(stlParts) ? stlParts.flat(Infinity) : [stlParts]).map(String).join('\n');

      res.writeHead(200, {
        'Content-Type': 'model/stl; charset=utf-8',
        'Content-Disposition': `attachment; filename="${outputName}"`,
        'Cache-Control': 'no-store'
      });
      res.end(stlText);
      return;
    }

    if (DEV_LIVE_RELOAD && req.url.startsWith(LIVE_RELOAD_PATH)) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive'
      });
      res.write('\n');
      liveReloadClients.add(res);
      req.on('close', () => {
        liveReloadClients.delete(res);
      });
      return;
    }

    const filePath = await resolvePath(req.url);
    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const contentType = getContentType(filePath);
    if (DEV_LIVE_RELOAD && contentType.startsWith('text/html')) {
      const html = await fsp.readFile(filePath, 'utf8');
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-store'
      });
      res.end(injectLiveReload(html));
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Internal Server Error\n${error.message}`);
  }
});

const liveReloadClients = new Set();

if (DEV_LIVE_RELOAD) {
  fs.watch(WEB_ROOT, { recursive: true }, () => {
    for (const client of liveReloadClients) {
      client.write('data: reload\n\n');
    }
  });
  fs.watch(MODELS_ROOT, { recursive: true }, () => {
    for (const client of liveReloadClients) {
      client.write('data: reload\n\n');
    }
  });
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Serving ${WEB_ROOT} at http://localhost:${PORT}${DEV_LIVE_RELOAD ? ' (dev live reload on)' : ''}`);
});
