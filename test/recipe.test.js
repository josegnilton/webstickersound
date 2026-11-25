// Runs the conversion recipe end to end with FFmpeg.
// Skipped when FFmpeg is not installed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ffmpeg, hasFfmpeg, probe } from '../server/ffmpeg.js';
import { isAnimatedWebp } from '../server/webp.js';
import {
  AUDIO_INPUT_GUARD,
  audioArgs,
  clampAudioStart,
  clampTrim,
  clipArgs,
  MAX_SECONDS,
  STICKER_LIMIT_KB,
  STICKER_STEPS,
  stickerArgs,
} from '../server/recipe.js';

const options = { skip: hasFfmpeg ? false : 'FFmpeg not installed' };
let dir;
const at = (name) => path.join(dir, name);
const runRecipe = (args) => ffmpeg(args);

test.before(async () => {
  if (!hasFfmpeg) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'figuraudio-test-'));
  await ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', at('wide.mp4'),
  ]);
  await ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=30:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', at('silent.mp4'),
  ]);
  await ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=8', '-c:a', 'flac', at('song.flac')]);
});

test.after(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

test('trim is clamped to the video and to 10 seconds', () => {
  assert.deepEqual(clampTrim(0, 30, 60), { start: 0, duration: MAX_SECONDS });
  assert.deepEqual(clampTrim(5, 10, 6), { start: 5, duration: 1 });
  assert.deepEqual(clampTrim(-3, 0.1, 6), { start: 0, duration: 0.5 });
});

test('the full recipe turns a video into a sticker and its sound', options, async () => {
  await runRecipe(clipArgs({ input: at('wide.mp4'), output: at('clip.mov'), start: 1, duration: 4, fit: 'cover' }));
  const clip = await probe(at('clip.mov'));
  assert.deepEqual([clip.width, clip.height], [512, 512]);
  assert.equal(clip.hasAudio, true);

  let kb = Infinity;
  for (const step of STICKER_STEPS) {
    await runRecipe(stickerArgs({ input: at('clip.mov'), output: at('out.webp'), ...step }));
    kb = (await fs.stat(at('out.webp'))).size / 1024;
    if (kb <= STICKER_LIMIT_KB) break;
  }
  assert.ok(kb <= STICKER_LIMIT_KB, `${kb} KB`);
  assert.equal(isAnimatedWebp(await fs.readFile(at('out.webp'))), true);
  const sticker = await probe(at('out.webp'));
  assert.deepEqual([sticker.width, sticker.height], [512, 512]);

  await runRecipe(audioArgs({ input: at('clip.mov'), output: at('out.ogg') }));
  const sound = await probe(at('out.ogg'));
  assert.ok(Math.abs(sound.duration - 4) < 0.2, `${sound.duration} s`);
});

test('"Mostrar tudo" keeps transparent padding in the sticker', options, async () => {
  await runRecipe(clipArgs({ input: at('wide.mp4'), output: at('contain.mov'), start: 0, duration: 1, fit: 'contain' }));
  await runRecipe(stickerArgs({ input: at('contain.mov'), output: at('contain.webp'), quality: 60, fps: 15 }));
  const header = (await fs.readFile(at('contain.webp'))).subarray(20, 21)[0];
  assert.equal(header & 0x10, 0x10, 'alpha flag set');
});

test('a silent video still gives a sticker', options, async () => {
  await runRecipe(clipArgs({ input: at('silent.mp4'), output: at('silent.mov'), start: 0, duration: 2, fit: 'cover' }));
  assert.equal((await probe(at('silent.mov'))).hasAudio, false);
  await runRecipe(stickerArgs({ input: at('silent.mov'), output: at('silent.webp'), quality: 60, fps: 15 }));
  assert.equal(isAnimatedWebp(await fs.readFile(at('silent.webp'))), true);
});

test('the start of a separate sound leaves at least half a second', () => {
  assert.equal(clampAudioStart(3, 8), 3);
  assert.equal(clampAudioStart(20, 8), 7.5);
  assert.equal(clampAudioStart(-1, 8), 0);
});

test('a separate sound replaces the sound of the video', options, async () => {
  const song = await probe(at('song.flac'), { inputGuard: AUDIO_INPUT_GUARD });
  assert.ok(song.audioDuration > 7.5, `${song.audioDuration} s`);
  await runRecipe(clipArgs({
    input: at('silent.mp4'), output: at('mixed.mov'), start: 0, duration: 2, fit: 'cover',
    audio: { file: at('song.flac'), start: 5 },
  }));
  assert.equal((await probe(at('mixed.mov'))).hasAudio, true);
  await runRecipe(audioArgs({ input: at('mixed.mov'), output: at('mixed.ogg') }));
  const sound = await probe(at('mixed.ogg'));
  assert.ok(Math.abs(sound.duration - 2) < 0.2, `${sound.duration} s`);
});
