// Turns any image/GIF/video into a 512x512 WebP sticker and any audio into
// the mono Opus clip WhatsApp expects.
import fs from 'node:fs/promises';
import { ffmpeg, probe } from './ffmpeg.js';
import { isAnimatedWebp } from './webp.js';

export const MAX_VISUAL_SECONDS = 10;
export const MAX_AUDIO_SECONDS = 10;

// WhatsApp accepts stills up to 100 KB and animations up to 500 KB.
const STATIC_LIMIT_KB = 96;
// Kept under WhatsApp's 500 KB so the pack metadata added on send still fits.
const ANIMATED_LIMIT_KB = 480;

const STATIC_QUALITIES = [90, 75, 60, 45, 30, 15];
const ANIMATED_STEPS = [
  { quality: 60, fps: 15 },
  { quality: 45, fps: 15 },
  { quality: 35, fps: 12 },
  { quality: 25, fps: 12 },
  { quality: 15, fps: 10 },
  { quality: 8, fps: 8 },
];

function frameFilter(fit) {
  if (fit === 'contain') {
    return 'scale=512:512:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,' +
      'pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000';
  }
  return 'scale=512:512:force_original_aspect_ratio=increase:flags=lanczos,crop=512:512';
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

async function sizeKB(file) {
  return Math.ceil((await fs.stat(file)).size / 1024);
}

export async function buildSticker({ input, output, fit, start, duration }) {
  const info = await probe(input);
  if (!info.hasVideo) throw new Error('O arquivo da figurinha não tem imagem.');

  if (!info.animated) {
    // A ready-made animated WebP sticker probes as a still image; keep it as is.
    const raw = await fs.readFile(input);
    const isWebp = raw.toString('latin1', 8, 12) === 'WEBP';
    if (isWebp && isAnimatedWebp(raw)) {
      if (raw.length / 1024 > ANIMATED_LIMIT_KB) {
        throw new Error('Essa figurinha animada passa do limite de 500 KB.');
      }
      await fs.writeFile(output, raw);
      return { animated: true, kb: await sizeKB(output), seconds: 0 };
    }

    let kb = 0;
    for (const quality of STATIC_QUALITIES) {
      await ffmpeg([
        '-i', input, '-frames:v', '1', '-vf', frameFilter(fit),
        '-c:v', 'libwebp', '-q:v', String(quality), '-compression_level', '6', output,
      ]);
      kb = await sizeKB(output);
      if (kb <= STATIC_LIMIT_KB) break;
    }
    if (kb > STATIC_LIMIT_KB) throw new Error('Não consegui deixar a imagem abaixo de 100 KB.');
    return { animated: false, kb, seconds: 0 };
  }

  const from = clamp(start, 0, Math.max(0, info.duration - 0.2));
  const seconds = clamp(duration || MAX_VISUAL_SECONDS, 0.2, Math.min(MAX_VISUAL_SECONDS, info.duration - from));
  let kb = 0;
  for (const { quality, fps } of ANIMATED_STEPS) {
    await ffmpeg([
      '-ss', String(from), '-t', String(seconds), '-i', input,
      '-vf', `fps=${fps},${frameFilter(fit)}`,
      '-c:v', 'libwebp_anim', '-q:v', String(quality), '-compression_level', '4',
      '-loop', '0', '-an', output,
    ]);
    kb = await sizeKB(output);
    if (kb <= ANIMATED_LIMIT_KB) break;
  }
  if (kb > ANIMATED_LIMIT_KB) {
    throw new Error('A figurinha passou de 500 KB mesmo na qualidade mínima. Diminua a duração.');
  }
  return { animated: true, kb, seconds };
}

export async function buildAudio({ input, output, start, duration }) {
  const info = await probe(input);
  if (!info.hasAudio) throw new Error('Esse arquivo não tem áudio.');

  const from = clamp(start, 0, Math.max(0, info.duration - 0.2));
  const seconds = clamp(duration || MAX_AUDIO_SECONDS, 0.2, Math.min(MAX_AUDIO_SECONDS, info.duration - from));
  await ffmpeg([
    '-ss', String(from), '-t', String(seconds), '-i', input, '-vn',
    '-af', 'aresample=async=1,asetpts=PTS-STARTPTS',
    '-c:a', 'libopus', '-application', 'voip', '-vbr', 'off',
    '-ac', '1', '-ar', '48000', '-b:a', '24k', output,
  ]);
  const result = await probe(output);
  return { seconds: result.duration };
}
