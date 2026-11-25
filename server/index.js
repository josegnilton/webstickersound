// FigSom: local web app. Upload a video, get a WhatsApp sticker with sound.
// The server only listens on this computer (127.0.0.1).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { hasFfmpeg, probe } from './ffmpeg.js';
import { buildAudio, buildSticker, MAX_AUDIO_SECONDS } from './media.js';
import { withPackMetadata } from './webp.js';
import { createWhatsApp } from './whatsapp.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WEB_DIR = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, 'data');
const WORK_DIR = path.join(DATA_DIR, 'work');
const PORT = Number(process.env.PORT) || 4827;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024;

const UPLOAD_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv', 'avi', 'gif']);
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const OUTPUT_FILES = {
  '/api/out/sticker.webp': ['sticker.webp', 'image/webp'],
  '/api/out/audio.ogg': ['audio.ogg', 'audio/ogg'],
};
const STICKER_FILE = path.join(WORK_DIR, 'sticker.webp');
const AUDIO_FILE = path.join(WORK_DIR, 'audio.ogg');

fs.mkdirSync(WORK_DIR, { recursive: true });
const whatsapp = createWhatsApp({ dataDir: DATA_DIR });

// One project at a time: the uploaded video and what was built from it.
let source = null; // { file, duration, hasAudio }
let built = null; // { kb, seconds, audioSeconds }
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
    'content-security-policy':
      "default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; object-src 'none'; base-uri 'none'",
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
    throw new HttpError(400, 'JSON inválido.');
  }
}

// Other sites open in the same browser must not be able to drive this server
// (it can send WhatsApp messages), so only the app's own page is accepted.
function assertLocalRequest(req) {
  const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  if (!allowedHosts.includes(req.headers.host)) throw new HttpError(403, 'Host não permitido.');
  if (req.method === 'GET') return;
  const origin = req.headers.origin;
  if (origin && !allowedHosts.some((host) => origin === `http://${host}`)) {
    throw new HttpError(403, 'Origem não permitida.');
  }
  if (req.headers['x-figsom'] !== '1') throw new HttpError(403, 'Pedido não permitido.');
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

async function handleUpload(req, url) {
  if (!hasFfmpeg) throw new HttpError(500, 'FFmpeg não encontrado. Instale com: winget install Gyan.FFmpeg');
  const extension = path.extname(url.searchParams.get('name') || '').slice(1).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(extension)) {
    throw new HttpError(400, 'Formato não aceito. Envie um vídeo (MP4, MOV, WebM, MKV, AVI) ou GIF.');
  }
  if (Number(req.headers['content-length']) > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Vídeo maior que 500 MB.');

  return exclusive(async () => {
    source = null;
    built = null;
    for (const name of await fsp.readdir(WORK_DIR)) await fsp.rm(path.join(WORK_DIR, name), { force: true });

    const file = path.join(WORK_DIR, `source.${extension}`);
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
    source = { file, duration: info.duration, hasAudio: info.hasAudio };
    return { duration: info.duration, hasAudio: info.hasAudio, maxSeconds: MAX_AUDIO_SECONDS };
  });
}

async function handleBuild(req) {
  const { start, duration, fit } = await readJson(req);
  if (!source) throw new HttpError(400, 'Envie um vídeo primeiro.');
  return exclusive(async () => {
    built = null;
    const sticker = await buildSticker({
      input: source.file,
      output: STICKER_FILE,
      fit: fit === 'contain' ? 'contain' : 'cover',
      start,
      duration,
    });
    let audioSeconds = 0;
    if (source.hasAudio) {
      const audio = await buildAudio({ input: source.file, output: AUDIO_FILE, start, duration: sticker.seconds });
      audioSeconds = audio.seconds;
    }
    built = { kb: sticker.kb, seconds: sticker.seconds, audioSeconds };
    return built;
  });
}

async function handleSend(req) {
  const { packName, author } = await readJson(req);
  if (!built) throw new HttpError(400, 'Converta um vídeo primeiro.');
  if (!built.audioSeconds) throw new HttpError(400, 'Esse vídeo não tem som.');
  return exclusive(async () => {
    const clean = (value, fallback) => String(value || '').trim().slice(0, 60) || fallback;
    const sticker = withPackMetadata(await fsp.readFile(STICKER_FILE), clean(packName, 'FigSom'), clean(author, 'FigSom'));
    const audio = await fsp.readFile(AUDIO_FILE);
    return whatsapp.sendSoundSticker({ sticker, audio, seconds: Math.ceil(built.audioSeconds) });
  });
}

async function route(req, res) {
  assertLocalRequest(req);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;

  if (req.method === 'GET' && STATIC_FILES[url.pathname]) {
    const [name, type] = STATIC_FILES[url.pathname];
    return sendFile(res, path.join(WEB_DIR, name), type);
  }
  if (req.method === 'GET' && OUTPUT_FILES[url.pathname]) {
    const [name, type] = OUTPUT_FILES[url.pathname];
    return sendFile(res, path.join(WORK_DIR, name), type);
  }

  switch (key) {
    case 'GET /api/status':
      return sendJson(res, 200, { ffmpeg: hasFfmpeg, whatsapp: whatsapp.getStatus(), built });
    case 'POST /api/upload':
      return sendJson(res, 200, await handleUpload(req, url));
    case 'POST /api/build':
      return sendJson(res, 200, await handleBuild(req));
    case 'POST /api/send':
      return sendJson(res, 200, await handleSend(req));
    case 'POST /api/whatsapp/connect':
      await whatsapp.connect();
      return sendJson(res, 200, whatsapp.getStatus());
    case 'POST /api/whatsapp/logout':
      await whatsapp.logout();
      return sendJson(res, 200, whatsapp.getStatus());
    default:
      throw new HttpError(404, 'Não encontrado.');
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
  if (!process.argv.includes('--open') || process.platform !== 'win32') return;
  spawn('cmd', ['/c', 'start', '', ADDRESS], { stdio: 'ignore', windowsHide: true }).unref();
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    // Most likely FigSom is already running: show that one.
    console.error(`A porta ${PORT} já está em uso. Se o FigSom já está aberto, acesse ${ADDRESS}`);
    openBrowser();
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`FigSom aberto em ${ADDRESS}`);
  console.log('Deixe esta janela aberta enquanto usa. Feche para encerrar.');
  whatsapp.resume().catch((error) => console.error(error));
  openBrowser();
});
