// Builds the sticker and its sound from the uploaded video, following the
// steps in recipe.js.
import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg, FfmpegError, probe } from './ffmpeg.js';
import {
  audioArgs,
  clampTrim,
  clipArgs,
  PHOTO_LIMIT_KB,
  PHOTO_QUALITIES,
  photoArgs,
  STICKER_LIMIT_KB,
  STICKER_STEPS,
  stickerArgs,
} from './recipe.js';

// Still sticker from a photo, without sound.
export async function buildPhotoSticker({ input, workDir, fit }) {
  const sticker = path.join(workDir, 'figurinha.webp');
  await fs.rm(path.join(workDir, 'som.ogg'), { force: true });
  let kb = Infinity;
  for (const quality of PHOTO_QUALITIES) {
    await ffmpeg(photoArgs({ input, output: sticker, fit: fit === 'contain' ? 'contain' : 'cover', quality }));
    kb = Math.ceil((await fs.stat(sticker)).size / 1024);
    if (kb <= PHOTO_LIMIT_KB) return { kb };
  }
  throw new FfmpegError('A figurinha passou de 100 KB mesmo na qualidade mínima. Tente outra foto.', 422);
}

// soundTrack: optional separate sound { file, start } that replaces the video's own.
export async function buildSticker({ input, workDir, totalSeconds, hasAudio, start, duration, fit, soundTrack }) {
  const trim = clampTrim(start, duration, totalSeconds);
  const clip = path.join(workDir, 'clip.mov');
  const sticker = path.join(workDir, 'figurinha.webp');
  const audio = path.join(workDir, 'som.ogg');
  await fs.rm(audio, { force: true });

  try {
    await ffmpeg(clipArgs({ input, output: clip, ...trim, fit: fit === 'contain' ? 'contain' : 'cover', audio: soundTrack }));

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
    if (soundTrack || hasAudio) {
      await ffmpeg(audioArgs({ input: clip, output: audio }));
      audioSeconds = (await probe(audio)).duration;
    }
    return { ...trim, kb, audioSeconds };
  } finally {
    await fs.rm(clip, { force: true });
  }
}
