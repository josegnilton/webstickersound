// Minimal WebP container (RIFF) reader/writer: detects animation and writes
// the sticker pack name and author that WhatsApp shows when a sticker is tapped.
import crypto from 'node:crypto';

const FLAG_ANIM = 0x02;
const FLAG_EXIF = 0x08;
const FLAG_ALPHA = 0x10;

function parseChunks(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') {
    throw new Error('Arquivo WebP inválido.');
  }
  const chunks = [];
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + size;
    if (end > buf.length) throw new Error('Arquivo WebP truncado.');
    chunks.push({ id, data: buf.subarray(pos + 8, end) });
    pos = end + (size % 2);
  }
  return chunks;
}

function serialize(chunks) {
  const parts = [];
  for (const { id, data } of chunks) {
    const header = Buffer.alloc(8);
    header.write(id, 0, 'latin1');
    header.writeUInt32LE(data.length, 4);
    parts.push(header, data);
    if (data.length % 2) parts.push(Buffer.alloc(1));
  }
  const body = Buffer.concat(parts);
  const riff = Buffer.alloc(12);
  riff.write('RIFF', 0, 'latin1');
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write('WEBP', 8, 'latin1');
  return Buffer.concat([riff, body]);
}

// Canvas size and alpha flag of a simple (non-extended) WebP.
function simpleImageInfo(chunks) {
  const lossy = chunks.find((c) => c.id === 'VP8 ');
  if (lossy) {
    return {
      width: lossy.data.readUInt16LE(6) & 0x3fff,
      height: lossy.data.readUInt16LE(8) & 0x3fff,
      alpha: false,
    };
  }
  const lossless = chunks.find((c) => c.id === 'VP8L');
  if (lossless) {
    const bits = lossless.data.readUInt32LE(1);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >>> 14) & 0x3fff) + 1,
      alpha: Boolean((bits >>> 28) & 1),
    };
  }
  throw new Error('WebP sem dados de imagem.');
}

export function isAnimatedWebp(buf) {
  const header = parseChunks(buf).find((c) => c.id === 'VP8X');
  return Boolean(header && header.data[0] & FLAG_ANIM);
}

function buildExif(packName, author) {
  const json = Buffer.from(
    JSON.stringify({
      'sticker-pack-id': crypto.randomBytes(16).toString('hex'),
      'sticker-pack-name': packName,
      'sticker-pack-publisher': author,
      emojis: ['😀'],
    }),
    'utf8',
  );
  // TIFF header with one entry (tag 0x5741) that points at the JSON.
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57,
    0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00,
  ]);
  tiff.writeUInt32LE(json.length, 14);
  return Buffer.concat([tiff, json]);
}

export function withPackMetadata(buf, packName, author) {
  let chunks = parseChunks(buf).filter((c) => c.id !== 'EXIF');
  const extended = chunks.find((c) => c.id === 'VP8X');
  if (extended) {
    const data = Buffer.from(extended.data);
    data[0] |= FLAG_EXIF;
    extended.data = data;
  } else {
    const { width, height, alpha } = simpleImageInfo(chunks);
    const data = Buffer.alloc(10);
    data[0] = FLAG_EXIF | (alpha ? FLAG_ALPHA : 0);
    data.writeUIntLE(width - 1, 4, 3);
    data.writeUIntLE(height - 1, 7, 3);
    chunks = [{ id: 'VP8X', data }, ...chunks];
  }
  chunks.push({ id: 'EXIF', data: buildExif(packName, author) });
  return serialize(chunks);
}
