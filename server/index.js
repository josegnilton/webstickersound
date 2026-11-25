// Figuráudio: runs on your own computer. Turns a piece of a video into a
// sticker with sound and sends it to your own WhatsApp chat.
// The server only listens on this computer (127.0.0.1).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { hasFfmpeg, probe } from './ffmpeg.js';
import { buildSticker } from './media.js';
import { MAX_SECONDS } from './recipe.js';
import { withPackMetadata } from './webp.js';
import { createWhatsApp } from './whatsapp.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_DIR = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, 'data');
const WORK_DIR = path.join(DATA_DIR, 'work');
const PORT = Number(process.env.PORT) || 4827;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_JSON_BYTES = 16 * 1024;
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', '3gp']);

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const OUTPUT_FILES = {
  '/api/arquivo/figurinha.webp': ['figurinha.webp', 'image/webp'],
  '/api/arquivo/som.ogg': ['som.ogg', 'audio/ogg'],
};
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

fs.mkdirSync(WORK_DIR, { recursive: true });
const whatsapp = createWhatsApp({ dataDir: DATA_DIR });

// One video at a time: what was uploaded and the sticker made from it.
let video = null; // { file, duration, hasAudio }
let sticker = null; // { start, duration, kb, audioSeconds }
let busy = false;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function sendFile(res, file, type) {
  let data;
  try {
    data = await fsp.readFile(file);
  } catch {
    throw new HttpError(404, 'Arquivo não encontrado.');
  }
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-security-policy': CONTENT_SECURITY_POLICY,
    'x-content-type-options': 'nosniff',
  });
  res.end(data);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new HttpError(413, 'Pedido grande demais.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Pedido inválido.');
  }
}

// Other sites open in the same browser must not drive this server (it can
// send WhatsApp messages): the host must be this server, a cross-site origin
// is refused, and the custom header forces a CORS preflight that never passes.
function assertLocalRequest(req) {
  const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  if (!allowedHosts.includes(req.headers.host)) throw new HttpError(403, 'Host não permitido.');
  if (req.method === 'GET') return;
  const origin = req.headers.origin;
  if (origin && !allowedHosts.some((host) => origin === `http://${host}`)) {
    throw new HttpError(403, 'Origem não permitida.');
  }
  if (req.headers['x-figuraudio'] !== '1') throw new HttpError(403, 'Pedido não permitido.');
}

async function exclusive(task) {
  if (busy) throw new HttpError(409, 'Ainda estou processando. Aguarde um instante.');
  busy = true;
  try {
    return await task();
  } finally {
    busy = false;
  }
}

function requireFfmpeg() {
  if (!hasFfmpeg) throw new HttpError(500, 'FFmpeg não encontrado. Veja o passo 1 do README.');
}

async function handleUpload(req, url) {
  requireFfmpeg();
  const extension = path.extname(url.searchParams.get('nome') || '').slice(1).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw new HttpError(400, 'Formato não aceito. Use um vídeo MP4, MOV, WebM, MKV ou AVI.');
  }
  if (Number(req.headers['content-length']) > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Vídeo maior que 500 MB.');

  return exclusive(async () => {
    video = null;
    sticker = null;
    for (const name of await fsp.readdir(WORK_DIR)) await fsp.rm(path.join(WORK_DIR, name), { force: true });

    const file = path.join(WORK_DIR, `video.${extension}`);
    let received = 0;
    await pipeline(
      req,
      async function* limit(stream) {
        for await (const chunk of stream) {
          received += chunk.length;
          if (received > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Vídeo maior que 500 MB.');
          yield chunk;
        }
      },
      fs.createWriteStream(file),
    );

    let info;
    try {
      info = await probe(file);
    } catch {
      throw new HttpError(400, 'Não consegui ler esse arquivo como vídeo.');
    }
    if (!info.hasVideo || !info.animated) throw new HttpError(400, 'Esse arquivo não é um vídeo.');
    video = { file, duration: info.duration, hasAudio: info.hasAudio };
    return { duration: info.duration, hasAudio: info.hasAudio, maxSeconds: MAX_SECONDS };
  });
}

async function handleBuild(req) {
  const { start, duration, fit } = await readJson(req);
  if (!video) throw new HttpError(400, 'Escolha um vídeo primeiro.');
  return exclusive(async () => {
    sticker = null;
    sticker = await buildSticker({
      input: video.file,
      workDir: WORK_DIR,
      totalSeconds: video.duration,
      hasAudio: video.hasAudio,
      start,
      duration,
      fit,
    });
    return sticker;
  });
}

async function handleSend(req) {
  const { packName, author } = await readJson(req);
  if (!sticker) throw new HttpError(400, 'Crie a figurinha primeiro.');
  if (!sticker.audioSeconds) throw new HttpError(400, 'Esse vídeo não tem som.');
  return exclusive(async () => {
    const clean = (value) => String(value || '').trim().slice(0, 60) || 'Figuráudio';
    const webp = withPackMetadata(await fsp.readFile(path.join(WORK_DIR, 'figurinha.webp')), clean(packName), clean(author));
    const audio = await fsp.readFile(path.join(WORK_DIR, 'som.ogg'));
    return whatsapp.sendSoundSticker({ sticker: webp, audio, seconds: Math.ceil(sticker.audioSeconds) });
  });
}

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  const file = path.resolve(WEB_DIR, relative);
  const type = CONTENT_TYPES[path.extname(file)];
  if (!file.startsWith(WEB_DIR + path.sep) || !type) throw new HttpError(404, 'Não encontrado.');
  return sendFile(res, file, type);
}

async function route(req, res) {
  assertLocalRequest(req);
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && OUTPUT_FILES[url.pathname]) {
    const [name, type] = OUTPUT_FILES[url.pathname];
    return sendFile(res, path.join(WORK_DIR, name), type);
  }

  switch (`${req.method} ${url.pathname}`) {
    case 'GET /api/status':
      return sendJson(res, 200, { ffmpeg: hasFfmpeg, whatsapp: whatsapp.getStatus() });
    case 'POST /api/video':
      return sendJson(res, 200, await handleUpload(req, url));
    case 'POST /api/figurinha':
      return sendJson(res, 200, await handleBuild(req));
    case 'POST /api/enviar':
      return sendJson(res, 200, await handleSend(req));
    case 'POST /api/whatsapp/conectar':
      await whatsapp.connect();
      return sendJson(res, 200, whatsapp.getStatus());
    case 'POST /api/whatsapp/desconectar':
      await whatsapp.logout();
      return sendJson(res, 200, whatsapp.getStatus());
    default:
      if (req.method !== 'GET' || url.pathname.startsWith('/api/')) throw new HttpError(404, 'Não encontrado.');
      return serveStatic(res, url.pathname);
  }
}

const server = http.createServer((req, res) => {
  route(req, res).catch((error) => {
    if (!error.status) console.error(error);
    if (res.headersSent) return res.destroy();
    // Drop the rest of a refused upload instead of reading it all.
    if (!req.complete) res.setHeader('connection', 'close');
    sendJson(res, error.status || 500, { error: error.message || 'Erro inesperado.' });
  });
});

const ADDRESS = `http://127.0.0.1:${PORT}`;

function openBrowser() {
  if (!process.argv.includes('--open')) return;
  const [command, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', ADDRESS]]
      : process.platform === 'darwin' ? ['open', [ADDRESS]]
        : ['xdg-open', [ADDRESS]];
  spawn(command, args, { stdio: 'ignore', windowsHide: true, detached: true }).on('error', () => {}).unref();
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`A porta ${PORT} já está em uso. Se o Figuráudio já está aberto, acesse ${ADDRESS}`);
    openBrowser();
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Figuráudio aberto em ${ADDRESS}`);
  if (!hasFfmpeg) console.log('Atenção: FFmpeg não encontrado. Veja o passo 1 do README.');
  console.log('Deixe esta janela aberta enquanto usa. Para encerrar, feche a janela ou aperte Ctrl+C.');
  whatsapp.resume().catch((error) => console.error(error));
  openBrowser();
});
