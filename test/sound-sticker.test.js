// Checks the raw bytes of the sound-sticker message, field by field.
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateWAMessageFromContent, proto } from '@whiskeysockets/baileys';
import protobuf from 'protobufjs/minimal.js';
import { registerSoundSticker } from '../server/sound-sticker.js';

const JID = '5511999999999@s.whatsapp.net';
const sha = (fill) => Buffer.alloc(32, fill);

function fields(bytes) {
  const reader = protobuf.Reader.create(bytes);
  const out = [];
  while (reader.pos < reader.len) {
    const tag = reader.uint32();
    const wire = tag & 7;
    let value = null;
    if (wire === 2) value = reader.bytes();
    else if (wire === 0) value = reader.uint64().toString();
    else reader.skipType(wire);
    out.push({ field: tag >>> 3, value });
  }
  return out;
}

function only(list, field) {
  const hits = list.filter((entry) => entry.field === field);
  assert.equal(hits.length, 1, `field ${field} should appear once`);
  return hits[0].value;
}

function makeMessage(sentTs) {
  const sticker = {
    url: 'https://mmg.whatsapp.net/s', fileSha256: sha(1), fileEncSha256: sha(2), mediaKey: sha(3),
    mimetype: 'image/webp', directPath: '/s', fileLength: 1234, mediaKeyTimestamp: 1,
    width: 512, height: 512, isAnimated: true, stickerSentTs: sentTs,
  };
  const audio = {
    url: 'https://mmg.whatsapp.net/a', fileSha256: sha(4), fileEncSha256: sha(5), mediaKey: sha(6),
    mimetype: 'audio/ogg; codecs=opus', directPath: '/a', fileLength: 99, mediaKeyTimestamp: 1,
    seconds: 5, ptt: false,
  };
  registerSoundSticker(sticker, audio);
  return generateWAMessageFromContent(JID, { stickerMessage: sticker }, { userJid: JID }).message;
}

function assertSoundSticker(messageBytes) {
  const top = fields(messageBytes);
  const stickerBytes = only(fields(only(fields(only(top, 134)), 1)), 26);
  const sticker = fields(stickerBytes);

  const decodedSticker = proto.Message.StickerMessage.decode(stickerBytes);
  assert.equal(decodedSticker.mimetype, 'image/webp');
  assert.equal(decodedSticker.isAnimated, true);

  const stickerPairing = fields(only(fields(only(sticker, 17)), 74));
  assert.equal(only(stickerPairing, 1), '1');
  assert.deepEqual(Buffer.from(only(stickerPairing, 2)), sha(1));

  const audioBytes = only(sticker, 26);
  const decodedAudio = proto.Message.AudioMessage.decode(audioBytes);
  assert.equal(decodedAudio.mimetype, 'audio/ogg; codecs=opus');
  assert.equal(decodedAudio.seconds, 5);

  const audioPairing = fields(only(fields(only(fields(audioBytes), 17)), 74));
  assert.equal(only(audioPairing, 1), '1');
  assert.deepEqual(Buffer.from(only(audioPairing, 2)), sha(4));
}

test('a registered sticker is encoded as a sound sticker', () => {
  assertSoundSticker(proto.Message.encode(makeMessage(1_700_000_000_001)).finish());
});

test('the copy sent to the own devices carries the sound sticker too', () => {
  const message = makeMessage(1_700_000_000_002);
  const bytes = proto.Message.encode({ deviceSentMessage: { destinationJid: JID, message } }).finish();
  const deviceSent = fields(only(fields(bytes), 31));
  assert.equal(Buffer.from(only(deviceSent, 1)).toString(), JID);
  assertSoundSticker(only(deviceSent, 2));
});

test('other messages are encoded normally', () => {
  const text = proto.Message.decode(proto.Message.encode({ conversation: 'oi' }).finish());
  assert.equal(text.conversation, 'oi');

  const plainSticker = { mimetype: 'image/webp', fileSha256: sha(9), stickerSentTs: 42 };
  const decoded = proto.Message.decode(proto.Message.encode({ stickerMessage: plainSticker }).finish());
  assert.equal(decoded.stickerMessage.mimetype, 'image/webp');
});
