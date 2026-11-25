// Locates FFmpeg/FFprobe and runs them without a shell.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EXE = process.platform === 'win32' ? '.exe' : '';

function findOnPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name + EXE);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// winget installs FFmpeg per user and only new shells see the PATH change,
// so look in its package folder too.
function findInWinget(name) {
  const base = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages');
  if (!base || !fs.existsSync(base)) return null;
  for (const pkg of fs.readdirSync(base)) {
    if (!pkg.toLowerCase().includes('ffmpeg')) continue;
    const pkgDir = path.join(base, pkg);
    for (const build of fs.readdirSync(pkgDir)) {
      const candidate = path.join(pkgDir, build, 'bin', name + EXE);
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
export const hasFfmpeg = Boolean(ffmpegPath && ffprobePath);

function run(bin, args, { timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!bin) return reject(new Error('FFmpeg não encontrado. Instale com: winget install Gyan.FFmpeg'));
    const child = spawn(bin, args, { windowsHide: true });
    const out = [];
    const err = [];
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout.on('data', (chunk) => out.push(chunk));
    child.stderr.on('data', (chunk) => err.push(chunk));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve(Buffer.concat(out).toString('utf8'));
      const tail = Buffer.concat(err).toString('utf8').trim().split(/\r?\n/).slice(-3).join(' | ');
      reject(new Error(`FFmpeg falhou (código ${code}): ${tail}`));
    });
  });
}

export function ffmpeg(args, options) {
  return run(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', ...args], options);
}

export async function probe(file) {
  const json = await run(ffprobePath, [
    '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file,
  ]);
  const info = JSON.parse(json);
  const streams = info.streams || [];
  const video = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const audio = streams.find((s) => s.codec_type === 'audio');
  const duration = Number(info.format?.duration) || 0;
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
