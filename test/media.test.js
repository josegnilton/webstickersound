// Runs the real FFmpeg pipeline on a generated clip. Skipped without FFmpeg.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ffmpeg, hasFfmpeg, probe } from '../server/ffmpeg.js';
import { buildAudio, buildSticker } from '../server/media.js';
import { isAnimatedWebp, withPackMetadata } from '../server/webp.js';

const options = { skip: hasFfmpeg ? false : 'FFmpeg not installed' };
let dir;

test.before(async () => {
  if (!hasFfmpeg) return;
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'figsom-test-'));
  await ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=24:duration=4',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(dir, 'clip.mp4'),
  ]);
  await ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'silent.mp4'),
  ]);
});

test.after(async () => {
  if (dir) await fs.rm(dir, { recursive: true, force: true });
});

test('a video becomes a 512x512 animated sticker under 500 KB', options, async () => {
  const output = path.join(dir, 'sticker.webp');
  const result = await buildSticker({ input: path.join(dir, 'clip.mp4'), output, fit: 'cover', start: 1, duration: 2 });
  assert.equal(result.animated, true);
  assert.equal(result.seconds, 2);
  assert.ok(result.kb <= 500, `${result.kb} KB`);

  const bytes = await fs.readFile(output);
  assert.equal(isAnimatedWebp(bytes), true);
  const info = await probe(output);
  assert.deepEqual([info.width, info.height], [512, 512]);
});

test('the clip never runs past the end of the video', options, async () => {
  const output = path.join(dir, 'tail.webp');
  const result = await buildSticker({ input: path.join(dir, 'clip.mp4'), output, fit: 'contain', start: 3, duration: 10 });
  assert.ok(result.seconds <= 1.01, `${result.seconds} s`);
});

test('the audio becomes an Opus clip of the same length', options, async () => {
  const output = path.join(dir, 'audio.ogg');
  const result = await buildAudio({ input: path.join(dir, 'clip.mp4'), output, start: 1, duration: 2 });
  assert.ok(Math.abs(result.seconds - 2) < 0.1, `${result.seconds} s`);
  assert.equal((await fs.readFile(output)).toString('latin1', 0, 4), 'OggS');
});

test('a video without sound is reported', options, async () => {
  await assert.rejects(
    buildAudio({ input: path.join(dir, 'silent.mp4'), output: path.join(dir, 'none.ogg'), start: 0, duration: 1 }),
    /não tem áudio/,
  );
});

test('pack metadata keeps the sticker a valid animated WebP', options, async () => {
  const output = path.join(dir, 'meta.webp');
  await buildSticker({ input: path.join(dir, 'clip.mp4'), output, fit: 'cover', start: 0, duration: 1 });
  const original = await fs.readFile(output);
  const tagged = withPackMetadata(original, 'Meu Pacote', 'Eu');

  assert.equal(tagged.readUInt32LE(4), tagged.length - 8);
  assert.equal(isAnimatedWebp(tagged), true);
  assert.ok(tagged.includes('"sticker-pack-name":"Meu Pacote"'));
  // Tagging twice replaces the metadata instead of stacking it.
  assert.equal(withPackMetadata(tagged, 'Meu Pacote', 'Eu').length, tagged.length);

  const taggedFile = path.join(dir, 'tagged.webp');
  await fs.writeFile(taggedFile, tagged);
  const info = await probe(taggedFile);
  assert.deepEqual([info.width, info.height], [512, 512]);
});
