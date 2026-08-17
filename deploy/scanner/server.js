/**
 * ClearTrade private malware scanner (Phase 5).
 *
 * A thin HTTP front end over clamd, implementing exactly the contract that
 * `scanForMalware()` in src/lib/document-storage.ts expects:
 *
 *   POST /scan  Content-Type: application/octet-stream   body = raw file bytes
 *     200 {"clean":true,  "engine":"clamav","version":"<engine>/<signatures>"}
 *     200 {"clean":false, "engine":"clamav","version":"...", "signature":"<name>"}
 *     4xx/5xx on any condition where cleanliness could not be established
 *
 * The single most important property: this service NEVER returns `clean:true` unless clamd
 * affirmatively said OK. Every error path returns non-2xx, which the client maps to `failed`,
 * which blocks the upload. A scanner that fails open is worse than no scanner, because it
 * creates the appearance of protection.
 *
 * No npm dependencies — clamd's INSTREAM protocol is simple enough to speak directly, and a
 * dependency-free scanner is one less supply-chain path into the service that inspects
 * customer documents.
 */

const http = require('node:http');
const net = require('node:net');
const { timingSafeEqual } = require('node:crypto');

const PORT = Number(process.env.PORT || 3000);
const CLAMD_SOCKET = process.env.CLAMD_SOCKET || '';
const CLAMD_HOST = process.env.CLAMD_HOST || '127.0.0.1';
const CLAMD_PORT = Number(process.env.CLAMD_PORT || 3310);
const AUTH_TOKEN = process.env.SCANNER_AUTH_TOKEN || '';
const MAX_BYTES = Number(process.env.SCANNER_MAX_BYTES || 32 * 1024 * 1024);
const CLAMD_TIMEOUT_MS = Number(process.env.CLAMD_TIMEOUT_MS || 60_000);
const clamdConnection = () => CLAMD_SOCKET ? { path: CLAMD_SOCKET } : { host: CLAMD_HOST, port: CLAMD_PORT };

/** Ask clamd for its engine + signature database version. Cached; refreshed on reconnect. */
function clamdCommand(command, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(clamdConnection());
    let out = '';
    const fail = (e) => { socket.destroy(); reject(e); };
    socket.setTimeout(timeoutMs, () => fail(new Error('clamd command timeout')));
    socket.on('error', fail);
    socket.on('connect', () => socket.write(`z${command}\0`));
    socket.on('data', (d) => { out += d.toString('utf8'); });
    socket.on('close', () => resolve(out.replace(/\0/g, '').trim()));
  });
}

/**
 * Stream bytes to clamd using INSTREAM.
 *
 * Wire format: `zINSTREAM\0`, then repeated <4-byte BE length><chunk>, then a zero-length
 * chunk to terminate. clamd replies `stream: OK` or `stream: <SIGNATURE> FOUND`.
 */
function clamdScan(buffer) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(clamdConnection());
    let reply = '';
    let settled = false;
    const fail = (e) => { if (!settled) { settled = true; socket.destroy(); reject(e); } };

    socket.setTimeout(CLAMD_TIMEOUT_MS, () => fail(new Error('clamd scan timeout')));
    socket.on('error', fail);
    socket.on('data', (d) => { reply += d.toString('utf8'); });

    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      const CHUNK = 64 * 1024;
      for (let offset = 0; offset < buffer.length; offset += CHUNK) {
        const chunk = buffer.subarray(offset, Math.min(offset + CHUNK, buffer.length));
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        socket.write(header);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk terminates the stream
    });

    socket.on('close', () => {
      if (settled) return;
      settled = true;
      const text = reply.replace(/\0/g, '').trim();
      if (/\bOK$/.test(text)) return resolve({ clean: true, signature: null });
      const found = text.match(/stream:\s*(.+?)\s+FOUND/);
      if (found) return resolve({ clean: false, signature: found[1] });
      // Anything unrecognised (including clamd's own ERROR responses) is NOT clean.
      reject(new Error(`unrecognised clamd reply: ${text.slice(0, 200) || '(empty)'}`));
    });
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    // Reject early when the sender declares an oversize payload, so we never buffer it.
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) {
      req.resume(); // drain rather than destroy — the client must still receive our 413
      reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
      return;
    }
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > limit) {
        over = true;
        // Keep draining instead of destroying the request. Destroying tears down the
        // connection before the response is flushed, which the client sees as a transport
        // failure rather than the documented 413 — a worse signal for the same condition.
        req.resume();
        reject(Object.assign(new Error('payload too large'), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { if (!over) reject(e); });
  });
}

const json = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
};

let versionCache = null;
async function engineVersion() {
  if (versionCache) return versionCache;
  const raw = await clamdCommand('VERSION').catch(() => '');
  // "ClamAV 1.4.2/27000/Mon Aug 17 2026" -> "1.4.2/27000"
  const m = raw.match(/ClamAV\s+([\d.]+)\/(\d+)/);
  versionCache = m ? `${m[1]}/${m[2]}` : (raw || 'unknown');
  return versionCache;
}

const server = http.createServer(async (req, res) => {
  try {
    // Liveness/readiness: readiness requires clamd to actually answer.
    if (req.method === 'GET' && req.url === '/health/live') return json(res, 200, { status: 'live' });
    if (req.method === 'GET' && req.url === '/health/ready') {
      const pong = await clamdCommand('PING').catch(() => '');
      if (!/PONG/.test(pong)) return json(res, 503, { status: 'clamd unavailable' });
      return json(res, 200, { status: 'ready', engine: 'clamav', version: await engineVersion() });
    }

    if (req.method !== 'POST' || !req.url.startsWith('/scan')) return json(res, 404, { error: 'not found' });

    // Private service, but authenticate anyway — network policy is not authorization.
    if (AUTH_TOKEN) {
      const provided = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      // Length-independent compare to avoid leaking the token via timing.
      const ok = provided.length === AUTH_TOKEN.length &&
        timingSafeEqual(Buffer.from(provided), Buffer.from(AUTH_TOKEN));
      if (!ok) return json(res, 401, { error: 'unauthorized' });
    }

    const bytes = await readBody(req, MAX_BYTES);
    if (bytes.length === 0) return json(res, 400, { error: 'empty body' });

    const version = await engineVersion();
    const result = await clamdScan(bytes);
    return json(res, 200, {
      clean: result.clean,
      engine: 'clamav',
      version,
      ...(result.signature ? { signature: result.signature } : {}),
      bytes: bytes.length,
    });
  } catch (error) {
    const status = error && error.statusCode ? error.statusCode : 502;
    // Never 200 here. The client maps non-2xx to `failed`, which blocks the upload.
    return json(res, status, { error: String((error && error.message) || error).slice(0, 300) });
  }
});

server.listen(PORT, () => {
  console.log(JSON.stringify({ event: 'scanner_listening', port: PORT, clamd: CLAMD_SOCKET || `${CLAMD_HOST}:${CLAMD_PORT}`, max_bytes: MAX_BYTES }));
});
