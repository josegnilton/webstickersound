// Builds the sticker and its sound from the uploaded video, following the
// steps in recipe.js.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg, FfmpegError, probe } from './ffmpeg.js';
import {
  audioArgs,
  clampTrim,
  clipArgs,
  STICKER_LIMIT_KB,
  STICKER_STEPS,
  stickerArgs,
} from './recipe.js';

export async function buildSticker({ input, workDir, totalSeconds, hasAudio, start, duration, fit }) {
  const trim = clampTrim(start, duration, totalSeconds);
  const clip = path.join(workDir, 'clip.mov');
  const sticker = path.join(workDir, 'figurinha.webp');
  const audio = path.join(workDir, 'som.ogg');
  await fs.rm(audio, { force: true });

  try {
    await ffmpeg(clipArgs({ input, output: clip, ...trim, fit: fit === 'contain' ? 'contain' : 'cover' }));

    let kb = Infinity;
    for (const step of STICKER_STEPS) {
      await ffmpeg(stickerArgs({ input: clip, output: sticker, ...step }));
      kb = Math.ceil((await fs.stat(sticker)).size / 1024);
      if (kb <= STICKER_LIMIT_KB) break;
    }
    if (kb > STICKER_LIMIT_KB) {
      throw new FfmpegError('A figurinha passou de 500 KB mesmo na qualidade mínima. Escolha um trecho mais curto.', 422);
    }

    let audioSeconds = 0;
    if (hasAudio) {
      await ffmpeg(audioArgs({ input: clip, output: audio }));
      audioSeconds = (await probe(audio)).duration;
    }
    return { ...trim, kb, audioSeconds };
  } finally {
    await fs.rm(clip, { force: true });
  }
}
