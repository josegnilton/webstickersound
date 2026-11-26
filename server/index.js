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
import { hasFfmpeg, INSTALL_HINT, missingEncoders, probe } from './ffmpeg.js';
import { buildPhotoSticker, buildSticker } from './media.js';
import { AUDIO_INPUT_GUARD, clampAudioStart, MAX_SECONDS, PHOTO_INPUT_GUARD, UPLOAD_INPUT_GUARD } from './recipe.js';
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
const PHOTO_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
// A separate sound can also come from another video.
const AUDIO_EXTENSIONS = new Set(['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', ...VIDEO_EXTENSIONS]);
// The separate sound keeps this name in data/work, so a new video does not erase it.
const TRACK_PREFIX = 'trilha.';

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
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

// data/ holds the WhatsApp session: keep it private to this user.
fs.mkdirSync(WORK_DIR, { recursive: true, mode: 0o700 });
if (process.platform !== 'win32') fs.chmodSync(DATA_DIR, 0o700);
// The last video is personal: do not keep it around between runs.
for (const name of fs.readdirSync(WORK_DIR)) fs.rmSync(path.join(WORK_DIR, name), { force: true, recursive: true });

// Last resort: a failed promise somewhere must not close the program.
process.on('unhandledRejection', (error) => console.error('Erro inesperado:', error));

const whatsapp = createWhatsApp({ dataDir: DATA_DIR });

// One video at a time: what was uploaded and the sticker made from it.
// The chosen video or photo.
let video = null; // { kind: 'video', file, duration, hasAudio } or { kind: 'photo', file }
let track = null; // separate sound: { file, duration }
let sticker = null; // { mode, kb, audioSeconds, start, duration, audioStart }
let busy = false;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Other sites may not load anything from this server, not even as <img>.
const COMMON_HEADERS = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'cross-origin-resource-policy': 'same-origin',
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...COMMON_HEADERS, 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function sendFile(res, file, type) {
  let data;
  try {
    data = await fsp.readFile(file);
  } catch {
    throw new HttpError(404, 'Arquivo não encontrado.');
  }
  res.writeHead(200, { ...COMMON_HEADERS, 'content-type': type, 'content-security-policy': CONTENT_SECURITY_POLICY });
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
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Pedido inválido.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Pedido inválido.');
  return value;
}

// Other sites open in the same browser must not drive this server (it can
// send WhatsApp messages): the host must be this server, a cross-site origin
// is refused, and the custom header forces a CORS preflight that never passes.
function assertLocalRequest(req) {
  const allowedHosts = [`127.0.0.1:${PORT}`, `localhost:${PORT}`];
  if (!allowedHosts.includes(req.headers.host)) throw new HttpError(403, 'Host não permitido.');
  // Browsers say where a request comes from; refuse API reads started by
  // another site (the page itself sends same-origin).
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none' && req.url.startsWith('/api/')) {
    throw new HttpError(403, 'Pedido não permitido.');
  }
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

function ffmpegProblem() {
  if (missingEncoders.length) {
    return `O FFmpeg instalado não tem ${missingEncoders.join(', ')}. Instale uma versão completa (passo 1 do README).`;
  }
  return `FFmpeg não encontrado. ${INSTALL_HINT}, feche e abra o Figuráudio de novo.`;
}

function requireFfmpeg() {
  if (!hasFfmpeg) throw new HttpError(500, ffmpegProblem());
}

function extensionOf(url) {
  return path.extname(url.searchParams.get('nome') || '').slice(1).toLowerCase();
}

// Streams the request body to file, stopping at the size limit.
async function receive(req, file) {
  let received = 0;
  await pipeline(
    req,
    async function* limit(stream) {
      for await (const chunk of stream) {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Arquivo maior que 500 MB.');
        yield chunk;
      }
    },
    fs.createWriteStream(file),
  );
}

async function clearWork({ keepTrack }) {
  for (const name of await fsp.readdir(WORK_DIR)) {
    if (keepTrack && name.startsWith(TRACK_PREFIX)) continue;
    await fsp.rm(path.join(WORK_DIR, name), { force: true });
  }
}

// What each kind of upload accepts and how it is read.
const UPLOADS = {
  video: {
    extensions: VIDEO_EXTENSIONS,
    refused: 'Formato não aceito. Use um vídeo MP4, MOV, M4V, WebM, MKV, AVI ou 3GP.',
    tooLarge: 'Vídeo maior que 500 MB.',
    unreadable: 'Não consegui ler esse arquivo como vídeo.',
    guard: UPLOAD_INPUT_GUARD,
  },
  photo: {
    extensions: PHOTO_EXTENSIONS,
    refused: 'Formato não aceito. Use uma foto JPG, PNG, WebP, GIF ou BMP.',
    tooLarge: 'Foto maior que 500 MB.',
    unreadable: 'Não consegui ler esse arquivo como foto.',
    guard: PHOTO_INPUT_GUARD,
  },
};

async function handleUpload(req, url, kind) {
  requireFfmpeg();
  const rules = UPLOADS[kind];
  const extension = extensionOf(url);
  if (!rules.extensions.has(extension)) throw new HttpError(400, rules.refused);
  if (Number(req.headers['content-length']) > MAX_UPLOAD_BYTES) throw new HttpError(413, rules.tooLarge);

  return exclusive(async () => {
    video = null;
    sticker = null;
    // A separate sound chosen before stays, so the video can be swapped.
    await clearWork({ keepTrack: true });

    const file = path.join(WORK_DIR, `${kind === 'photo' ? 'foto' : 'video'}.${extension}`);
    await receive(req, file);

    let info;
    try {
      info = await probe(file, { inputGuard: rules.guard });
    } catch {
      throw new HttpError(400, rules.unreadable);
    }
    if (kind === 'photo') {
      if (!info.hasVideo || !info.width) throw new HttpError(400, 'Esse arquivo não é uma foto.');
      video = { kind, file };
      return { kind };
    }
    if (!info.hasVideo || !info.animated) throw new HttpError(400, 'Esse arquivo não é um vídeo.');
    video = { kind, file, duration: info.duration, hasAudio: info.hasAudio };
    return { kind, duration: info.duration, hasAudio: info.hasAudio, maxSeconds: MAX_SECONDS };
  });
}

async function removeTrack() {
  track = null;
  sticker = null;
  for (const name of await fsp.readdir(WORK_DIR)) {
    if (name.startsWith(TRACK_PREFIX)) await fsp.rm(path.join(WORK_DIR, name), { force: true });
  }
}

// A sound file (or another video) whose sound replaces the video's own.
async function handleAudioUpload(req, url) {
  requireFfmpeg();
  const extension = extensionOf(url);
  if (!AUDIO_EXTENSIONS.has(extension)) {
    throw new HttpError(400, 'Formato não aceito. Use um áudio MP3, M4A, AAC, OGG, Opus, WAV ou FLAC, ou um vídeo.');
  }
  if (Number(req.headers['content-length']) > MAX_UPLOAD_BYTES) throw new HttpError(413, 'Áudio maior que 500 MB.');

  return exclusive(async () => {
    // Read the new sound beside the old one: if it fails, the old one stays.
    const incoming = path.join(WORK_DIR, `novo-${TRACK_PREFIX}${extension}`);
    try {
      await receive(req, incoming);
      let info;
      try {
        info = await probe(incoming, { inputGuard: AUDIO_INPUT_GUARD });
      } catch {
        throw new HttpError(400, 'Não consegui ler esse arquivo como áudio.');
      }
      if (!info.hasAudio || !(info.audioDuration > 0)) throw new HttpError(400, 'Esse arquivo não tem som.');

      await removeTrack();
      const file = path.join(WORK_DIR, `${TRACK_PREFIX}${extension}`);
      await fsp.rename(incoming, file);
      track = { file, duration: info.audioDuration };
      return { duration: track.duration };
    } finally {
      await fsp.rm(incoming, { force: true });
    }
  });
}

const MODES = new Set(['video', 'video-audio', 'foto']);

// mode: 'video' (the video's own sound), 'video-audio' (a separate sound in
// place of the video's) or 'foto' (a still sticker without sound).
async function handleBuild(req) {
  const { mode = 'video', start, duration, fit, audioStart } = await readJson(req);
  if (!MODES.has(mode)) throw new HttpError(400, 'Pedido inválido.');
  const wantsPhoto = mode === 'foto';
  if (!video || (video.kind === 'photo') !== wantsPhoto) {
    throw new HttpError(400, wantsPhoto ? 'Escolha uma foto primeiro.' : 'Escolha um vídeo primeiro.');
  }
  if (mode === 'video-audio' && !track) throw new HttpError(400, 'Escolha o áudio primeiro.');

  return exclusive(async () => {
    sticker = null;
    if (wantsPhoto) {
      const { kb } = await buildPhotoSticker({ input: video.file, workDir: WORK_DIR, fit });
      sticker = { mode, kb, audioSeconds: 0 };
      return sticker;
    }
    const audio = mode === 'video-audio' ? { file: track.file, start: clampAudioStart(audioStart, track.duration) } : null;
    const built = await buildSticker({
      input: video.file,
      workDir: WORK_DIR,
      totalSeconds: video.duration,
      hasAudio: video.hasAudio,
      start,
      duration,
      fit,
      soundTrack: audio,
    });
    sticker = { mode, ...built, audioStart: audio ? audio.start : null };
    return sticker;
  });
}

async function handleSend(req) {
  const { packName, author } = await readJson(req);
  if (!sticker) throw new HttpError(400, 'Crie a figurinha primeiro.');
  if (whatsapp.getStatus().state !== 'open') throw new HttpError(409, 'Conecte o WhatsApp antes de enviar.');
  return exclusive(async () => {
    const clean = (value) => String(value || '').trim().slice(0, 60) || 'Figuráudio';
    const webp = withPackMetadata(await fsp.readFile(path.join(WORK_DIR, 'figurinha.webp')), clean(packName), clean(author));
    // A video without sound goes as a plain animated sticker.
    const audio = sticker.audioSeconds ? await fsp.readFile(path.join(WORK_DIR, 'som.ogg')) : null;
    return whatsapp.sendSticker({
      sticker: webp,
      animated: sticker.mode !== 'foto',
      audio,
      seconds: Math.ceil(sticker.audioSeconds),
    });
  });
}

async function serveStatic(res, pathname) {
  let relative;
  try {
    relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
  } catch {
    throw new HttpError(404, 'Não encontrado.');
  }
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
      return sendJson(res, 200, {
        ffmpeg: hasFfmpeg,
        ffmpegProblem: hasFfmpeg ? null : ffmpegProblem(),
        whatsapp: whatsapp.getStatus(),
      });
    case 'POST /api/video':
      return sendJson(res, 200, await handleUpload(req, url, 'video'));
    case 'POST /api/foto':
      return sendJson(res, 200, await handleUpload(req, url, 'photo'));
    case 'POST /api/audio':
      return sendJson(res, 200, await handleAudioUpload(req, url));
    case 'POST /api/figurinha':
      return sendJson(res, 200, await handleBuild(req));
    case 'POST /api/enviar':
      return sendJson(res, 200, await handleSend(req));
    case 'POST /api/whatsapp/conectar':
      await whatsapp.connect();
      return sendJson(res, 200, whatsapp.getStatus());
    case 'POST /api/whatsapp/novo-qr':
      await whatsapp.newQr();
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
    // A browser that gave up on an upload is not a server problem.
    const aborted = error.code === 'ECONNRESET' || error.code === 'ERR_STREAM_PREMATURE_CLOSE';
    if (!error.status && !aborted) console.error(error);
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
  if (!hasFfmpeg) console.log(`Atenção: ${ffmpegProblem()}`);
  console.log('Deixe esta janela aberta enquanto usa. Para encerrar, feche a janela ou aperte Ctrl+C.');
  whatsapp.resume().catch((error) => console.error(error));
  openBrowser();
});
