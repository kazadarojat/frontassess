'use strict';

/**
 * FrontStellar Assess server.
 *
 * Zero-dependency Node server that:
 *   1. serves the static UI from /public
 *   2. validates an OpenAI-compatible provider (GET /models)
 *   3. proxies a streaming chat completion and measures TTFT / total / TPS
 *
 * The proxy exists because most providers block browser CORS and because
 * timing must be measured on a single clock, next to the network socket.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 5173);
const PUBLIC_DIR = fs.existsSync(path.join(__dirname, 'public', 'index.html'))
  ? path.join(__dirname, 'public') : __dirname;
const MODELS_TIMEOUT_MS = 30000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/* ------------------------------------------------------------------ utils */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sseWrite(res, obj) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

function readJsonBody(req, limit = 1024 * 1024) {
  // Vercel Functions preparse JSON into req.body before this handler runs.
  if (req.body !== undefined && req.body !== null) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > limit) {
      return Promise.reject(new Error('Payload terlalu besar'));
    }
    return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
  }
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload terlalu besar'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(new Error('Body bukan JSON yang valid'));
      }
    });
    req.on('error', reject);
  });
}

function stripSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

/** Build candidate endpoints, tolerating a Base URL given with or without /v1. */
function validateProviderUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { throw new Error('URL provider tidak valid.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('URL provider hanya boleh berisi alamat HTTP(S) tanpa kredensial, query, atau fragment.');
  }
  const host = url.hostname.toLowerCase().replace(/[.]$/, '');
  const isLocal = host === 'localhost' || host.endsWith('.localhost') ||
    host === '127.0.0.1' || host === '::1' || host === '[::1]';
  const isPrivateIp = /^(?:10[.]|127[.]|0[.]|169[.]254[.]|192[.]168[.]|172[.](?:1[6-9]|2[0-9]|3[01])[.]|100[.](?:6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])[.])/.test(host);
  if ((isLocal || isPrivateIp || host.endsWith('.internal') || host.endsWith('.local') || host === 'metadata.google.internal') && process.env.ALLOW_PRIVATE_PROVIDERS !== 'true') {
    throw new Error('Alamat API lokal atau jaringan privat tidak diizinkan pada server publik.');
  }
  if (process.env.VERCEL && url.protocol !== 'https:') {
    throw new Error('Backend publik hanya menerima alamat provider HTTPS.');
  }
  return url.toString().replace(/[/]$/, '');
}

function endpointCandidates(baseUrl, resource) {
  const base = stripSlash(baseUrl);
  const list = [`${base}/${resource}`];
  if (!/\/v\d+(\/|$)/i.test(base)) list.push(`${base}/v1/${resource}`);
  return list;
}

function buildHeaders(apiKey, extra) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return Object.assign(headers, extra || {});
}

function extractApiError(status, text, data) {
  if (data) {
    if (typeof data.error === 'string' && data.error) return data.error;
    if (data.error && typeof data.error.message === 'string') return data.error.message;
    if (typeof data.message === 'string') return data.message;
    if (typeof data.detail === 'string') return data.detail;
    if (Array.isArray(data.detail) && data.detail[0] && data.detail[0].msg) return data.detail[0].msg;
  }
  const snippet = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  return snippet || `HTTP ${status}`;
}

/** Some providers emit content as `[{type:'text',text:'...'}]` instead of a string. */
function asText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  if (value && typeof value.text === 'string') return value.text;
  return '';
}

function pickModelArray(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.models)) return data.models;
  if (data.data && Array.isArray(data.data.models)) return data.data.models;
  return [];
}

function normalizeModels(data) {
  const seen = new Set();
  const out = [];
  for (const raw of pickModelArray(data)) {
    const id =
      typeof raw === 'string' ? raw : raw && (raw.id || raw.name || raw.model || raw.slug);
    if (!id) continue;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: key,
      owner: (raw && (raw.owned_by || raw.owner || raw.provider)) || '',
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/* ------------------------------------------------------- POST /api/models */

async function handleModels(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  let baseUrl;
  try { baseUrl = validateProviderUrl(stripSlash(body.baseUrl)); }
  catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }
  const apiKey = String(body.apiKey || '').trim();

  if (!baseUrl) return sendJson(res, 400, { ok: false, error: 'API Base URL wajib diisi.' });
  if (!/^https?:\/\//i.test(baseUrl)) {
    return sendJson(res, 400, { ok: false, error: 'API Base URL harus diawali http:// atau https://' });
  }

  const candidates = endpointCandidates(baseUrl, 'models');
  const attempts = [];

  for (const url of candidates) {
    const started = Date.now();
    try {
      const upstream = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(apiKey),
        signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
        redirect: 'error',
      });
      const text = await upstream.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (_) {
        /* keep data null, fall back to raw text */
      }
      const latency = Date.now() - started;

      if (!upstream.ok) {
        attempts.push({
          url,
          status: upstream.status,
          error: extractApiError(upstream.status, text, data),
        });
        continue;
      }

      const resolvedBase = stripSlash(url.slice(0, url.length - 'models'.length));
      return sendJson(res, 200, {
        ok: true,
        status: upstream.status,
        url,
        resolvedBase,
        latency,
        models: normalizeModels(data),
      });
    } catch (err) {
      attempts.push({
        url,
        status: 0,
        error: err.name === 'TimeoutError' ? 'Timeout saat menghubungi provider (30s)' : err.message,
      });
    }
  }

  const last = attempts[attempts.length - 1] || {};
  return sendJson(res, 200, {
    ok: false,
    url: candidates[0],
    resolvedBase: baseUrl,
    status: last.status || 0,
    error: last.error || 'Gagal menghubungi provider.',
    attempts,
  });
}

/* --------------------------------------------------------- POST /api/chat */

async function handleChat(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: err.message });
  }

  let baseUrl;
  try { baseUrl = validateProviderUrl(stripSlash(body.resolvedBase || body.baseUrl)); }
  catch (err) { return sendJson(res, 400, { ok: false, error: err.message }); }
  const apiKey = String(body.apiKey || '').trim();
  const model = String(body.model || '').trim();
  const prompt = String(body.prompt == null ? '' : body.prompt);
  const system = String(body.system == null ? '' : body.system).trim();
  const { temperature, maxTokens } = body;

  if (!baseUrl || !model) {
    return sendJson(res, 400, { ok: false, error: 'baseUrl dan model wajib diisi.' });
  }

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });

  const payload = { model, messages, stream: true };
  if (temperature !== '' && temperature !== null && temperature !== undefined) {
    payload.temperature = Number(temperature);
  }
  if (maxTokens !== '' && maxTokens !== null && maxTokens !== undefined && Number(maxTokens) > 0) {
    payload.max_tokens = Number(maxTokens);
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  if (res.flushHeaders) res.flushHeaders();

  const controller = new AbortController();
  let clientGone = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort();
    }
  });

  const t0 = performance.now();
  const candidates = endpointCandidates(baseUrl, 'chat/completions');

  let upstream = null;
  let failure = null;

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(apiKey, { Accept: 'text/event-stream' }),
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'error',
      });

      if (response.ok && response.body) {
        upstream = response;
        break;
      }

      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (_) {
        /* ignore */
      }
      failure = {
        status: response.status,
        message: extractApiError(response.status, text, data),
        retryAfter: response.headers.get('retry-after'),
      };
      if (response.status !== 404 && response.status !== 405) break;
    } catch (err) {
      if (clientGone) return res.end();
      failure = {
        status: 0,
        message: err.name === 'TimeoutError' ? 'Timeout saat menghubungi provider' : err.message,
      };
      break;
    }
  }

  if (!upstream) {
    sseWrite(res, {
      type: 'error',
      status: (failure && failure.status) || 0,
      message: (failure && failure.message) || 'Gagal menghubungi provider.',
      retryAfter: (failure && failure.retryAfter) || null,
    });
    sseWrite(res, { type: 'done', metrics: { failed: true, total: performance.now() - t0 } });
    return res.end();
  }

  let ttft = null;
  let chars = 0;
  let chunks = 0;
  let reasoningChars = 0;
  let usage = null;
  let finishReason = null;

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (rawLine) => {
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line || line.startsWith(':') || !line.startsWith('data:')) return;
    const dataStr = line.slice(5).trim();
    if (!dataStr || dataStr === '[DONE]') return;

    let chunk;
    try {
      chunk = JSON.parse(dataStr);
    } catch (_) {
      return;
    }

    if (chunk.usage) usage = chunk.usage;
    if (chunk.error) {
      sseWrite(res, { type: 'error', message: extractApiError(200, '', chunk) });
      return;
    }

    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : null;
    if (!choice) return;
    if (choice.finish_reason) finishReason = choice.finish_reason;

    const delta = choice.delta || choice.message || {};
    const content = asText(delta.content);
    const reasoning = asText(delta.reasoning_content || delta.reasoning);

    if (content || reasoning) {
      if (ttft === null) ttft = performance.now() - t0;
    }
    if (reasoning) {
      reasoningChars += reasoning.length;
      sseWrite(res, { type: 'delta', reasoning });
    }
    if (content) {
      chars += content.length;
      chunks += 1;
      sseWrite(res, { type: 'delta', content });
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        handleLine(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    buffer += decoder.decode();

    const leftover = buffer;
    buffer = '';
    leftover.split('\n').forEach(handleLine);

    // Fallback: provider ignored `stream: true` and returned a single JSON body.
    if (ttft === null && leftover.trim()) {
      try {
        const obj = JSON.parse(leftover.trim());
        if (obj.usage) usage = obj.usage;
        const text = asText(obj.choices && obj.choices[0] && (obj.choices[0].message || {}).content);
        if (text) {
          ttft = performance.now() - t0;
          chars = text.length;
          chunks = 1;
          sseWrite(res, { type: 'delta', content: text });
        }
        if (obj.choices && obj.choices[0] && obj.choices[0].finish_reason) {
          finishReason = obj.choices[0].finish_reason;
        }
      } catch (_) {
        /* not a JSON body, ignore */
      }
    }
  } catch (err) {
    if (!clientGone) {
      sseWrite(res, {
        type: 'error',
        message: err.name === 'AbortError' ? 'Stream dibatalkan' : err.message,
      });
    }
  }

  const total = performance.now() - t0;
  const completionTokens =
    usage && typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null;
  const promptTokens = usage && typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null;
  const tokens =
    completionTokens != null ? completionTokens : (chars > 0 ? Math.max(1, Math.round(chars / 4)) : 0);
  const generationMs = ttft == null ? null : total - ttft;
  // Avoid manufacturing a huge token/s figure when generation time rounds to zero.
  const tps = generationMs != null && generationMs >= 1 && tokens > 0
    ? tokens / (generationMs / 1000) : null;

  sseWrite(res, {
    type: 'done',
    metrics: {
      ttft,
      total,
      tokens,
      promptTokens,
      completionTokens,
      estimatedTokens: completionTokens == null,
      chars,
      chunks,
      reasoningChars,
      tps,
      finishReason,
    },
  });

  res.end();
}

/* -------------------------------------------------------------- static UI */

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^[/\\]+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { ok: false, error: 'Forbidden' });
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

/* ------------------------------------------------------------------ boot */

function requestHandler(req, res) {
  // Allow only configured web origins to access API from another domain.
  const origin = req.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(origin && allowed.includes(origin) ? 204 : 403);
    return res.end();
  }
  const { pathname } = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'POST' && pathname === '/api/models') return handleModels(req, res);
  if (req.method === 'POST' && pathname === '/api/chat') return handleChat(req, res);
  if (req.method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { ok: true });
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname);

  sendJson(res, 404, { ok: false, error: 'Not found' });
}

module.exports = requestHandler;

if (require.main === module) {
  http.createServer(requestHandler).listen(PORT, () => {
    console.log(`FrontStellar Assess berjalan di http://localhost:${PORT}`);
  });
}
