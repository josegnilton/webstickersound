import assert from 'node:assert/strict';
import test from 'node:test';
import { isAnimatedWebp, withPackMetadata } from '../server/webp.js';

function chunk(id, data) {
  const header = Buffer.alloc(8);
  header.write(id, 0, 'latin1');
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
}

function webp(...chunks) {
  const body = Buffer.concat(chunks);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 'latin1');
  return Buffer.concat([riff, body]);
}

// Lossy bitstream header for a 512x512 frame (no pixel data needed here).
function lossyChunk() {
  const data = Buffer.alloc(10);
  data.set([0x9d, 0x01, 0x2a], 3);
  data.writeUInt16LE(512, 6);
  data.writeUInt16LE(512, 8);
  return chunk('VP8 ', data);
}

test('a simple WebP gains an extended header with the right canvas size', () => {
  const tagged = withPackMetadata(webp(lossyChunk()), 'Pacote', 'Autor');
  assert.equal(tagged.toString('latin1', 12, 16), 'VP8X');
  assert.equal(tagged[20] & 0x08, 0x08, 'EXIF flag');
  assert.equal(tagged.readUIntLE(24, 3), 511);
  assert.equal(tagged.readUIntLE(27, 3), 511);
  assert.equal(tagged.readUInt32LE(4), tagged.length - 8);
  assert.equal(isAnimatedWebp(tagged), false);
});

test('an animated WebP keeps its animation flag', () => {
  const header = Buffer.alloc(10);
  header[0] = 0x02;
  const tagged = withPackMetadata(webp(chunk('VP8X', header), chunk('ANIM', Buffer.alloc(6))), 'Pacote', 'Autor');
  assert.equal(isAnimatedWebp(tagged), true);
  assert.equal(tagged[20] & 0x0a, 0x0a, 'ANIM and EXIF flags');
});

test('a file that is not WebP is rejected', () => {
  assert.throws(() => withPackMetadata(Buffer.from('not a webp file'), 'a', 'b'), /WebP inválido/);
});
