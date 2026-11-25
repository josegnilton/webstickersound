// Locates FFmpeg/FFprobe and runs them without a shell.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EXE = process.platform === 'win32' ? '.exe' : '';
const DEFAULT_TIMEOUT_MS = 120_000;
const STDERR_KEEP_BYTES = 8 * 1024;
// Encoders the recipe needs; some minimal FFmpeg builds lack them.
const REQUIRED_ENCODERS = ['libwebp_anim', 'libopus', 'png', 'pcm_s16le'];

function findOnPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name + EXE);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function subfolders(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

// winget installs FFmpeg per user and only new shells see the PATH change,
// so look in its package folder too.
function findInWinget(name) {
  const base = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (!base) return null;
  for (const pkg of subfolders(base)) {
    if (!pkg.toLowerCase().includes('ffmpeg')) continue;
    for (const build of subfolders(path.join(base, pkg))) {
      const candidate = path.join(base, pkg, build, 'bin', name + EXE);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function locate(name) {
  return findOnPath(name) || (process.platform === 'win32' ? findInWinget(name) : null);
}

export const ffmpegPath = locate('ffmpeg');
export const ffprobePath = locate('ffprobe');

function findMissingEncoders() {
  if (!ffmpegPath) return [];
  const result = spawnSync(ffmpegPath, ['-hide_banner', '-encoders'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
  const list = result.stdout || '';
  return REQUIRED_ENCODERS.filter((name) => !new RegExp(`\\s${name}\\s`).test(list));
}

export const missingEncoders = findMissingEncoders();
export const hasFfmpeg = Boolean(ffmpegPath && ffprobePath) && missingEncoders.length === 0;

export const INSTALL_HINT = {
  win32: 'Instale com: winget install Gyan.FFmpeg',
  darwin: 'Instale com: brew install ffmpeg',
}[process.platform] || 'Instale com o gerenciador de pacotes, por exemplo: sudo apt install ffmpeg';

export class FfmpegError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.status = status;
  }
}

function run(bin, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!bin) return reject(new FfmpegError(`FFmpeg não encontrado. ${INSTALL_HINT}`));
    const child = spawn(bin, args, { windowsHide: true });
    const out = [];
    let errTail = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => out.push(chunk));
    // A corrupt file can make FFmpeg print megabytes of errors; keep the end.
    child.stderr.on('data', (chunk) => {
      errTail = (errTail + chunk.toString('utf8')).slice(-STDERR_KEEP_BYTES);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new FfmpegError('O vídeo demorou demais para converter. Tente um trecho ou um vídeo menor.', 422));
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      const tail = errTail.trim().split(/\r?\n/).slice(-3).join(' | ');
      reject(new FfmpegError(`O FFmpeg não conseguiu converter este vídeo (${tail || `código ${code}`}).`, 422));
    });
  });
}

export function ffmpeg(args, options) {
  return run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], options);
}

// "01:02:03.500" -> 3723.5
function clockToSeconds(value) {
  const parts = String(value || '').split(':').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// inputGuard: extra input options placed before the file, such as the
// format whitelist used for uploads.
export async function probe(file, { inputGuard = [] } = {}) {
  const json = await run(ffprobePath, [
    '-v', 'error', ...inputGuard, '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  const info = JSON.parse(json);
  const streams = info.streams || [];
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const audio = streams.find((s) => s.codec_type === 'audio');
  // Prefer the video track's own length: the container may run longer (sound
  // past the last frame), and browser recordings often have no container
  // duration at all.
  const duration =
    Number(video?.duration) || clockToSeconds(video?.tags?.DURATION) || Number(info.format?.duration) || 0;
  return {
    duration,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    width: video?.width || 0,
    height: video?.height || 0,
    // A still image probes as one frame with a duration of a frame or less.
    animated: Boolean(video) && duration > 0.15 && video.nb_frames !== '1',
  };
}
