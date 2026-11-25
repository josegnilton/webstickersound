// The sound-sticker message itself.
//
// WhatsApp has not published this format. The layout used here (audio message
// embedded in the sticker message, both wrapped in top-level field 134)
// follows the one found by the Figaudio project
// (github.com/pandaNinja9714/Figaudio, Apache-2.0).
import { proto } from '@whiskeysockets/baileys';

// Protobuf field numbers that Baileys' schema does not know yet.
const TAG_CONTEXT_INFO = (17 << 3) | 2; // StickerMessage/AudioMessage.contextInfo
const TAG_CONTEXT_PAIRING = (74 << 3) | 2; // ContextInfo: links sticker and audio
const TAG_STICKER_AUDIO = (26 << 3) | 2; // StickerMessage: embedded AudioMessage
const TAG_MESSAGE_STICKER = (26 << 3) | 2; // Message.stickerMessage
const TAG_WRAPPER_MESSAGE = (1 << 3) | 2; // FutureProofMessage.message
const TAG_MESSAGE_SOUND_STICKER = (134 << 3) | 2; // Message: sound-sticker wrapper
const TAG_MESSAGE_CONTEXT_INFO = (35 << 3) | 2; // Message.messageContextInfo

const Writer = proto.Message.encode(proto.Message.create()).constructor;

// Baileys encodes the outgoing message itself (once per recipient device and
// again on retries), so the raw sound-sticker bytes are swapped in at encode
// time. Each pending sticker is found by its unique stickerSentTs.
const pendingPayloads = new Map();
const MAX_PENDING = 20;
const encodeMessage = proto.Message.encode;
proto.Message.encode = function encodeWithSoundSticker(message, writer) {
  const sentTs = message?.stickerMessage?.stickerSentTs;
  const payload = sentTs != null && !message.deviceSentMessage ? pendingPayloads.get(String(sentTs)) : null;
  if (!payload) return encodeMessage.call(this, message, writer);

  const out = writer || new Writer();
  out.uint32(TAG_MESSAGE_SOUND_STICKER).bytes(payload);
  if (message.messageContextInfo) {
    proto.MessageContextInfo.encode(message.messageContextInfo, out.uint32(TAG_MESSAGE_CONTEXT_INFO).fork()).ldelim();
  }
  return out;
};

function pairingContextInfo(fileSha256) {
  const pairing = new Writer();
  pairing.uint32((1 << 3) | 0).uint32(1);
  pairing.uint32((2 << 3) | 2).bytes(fileSha256);
  return new Writer().uint32(TAG_CONTEXT_PAIRING).bytes(pairing.finish()).finish();
}

function buildPayload(sticker, audio) {
  const audioWriter = new Writer();
  proto.Message.AudioMessage.encode(audio, audioWriter);
  audioWriter.uint32(TAG_CONTEXT_INFO).bytes(pairingContextInfo(audio.fileSha256));

  const stickerWriter = new Writer();
  proto.Message.StickerMessage.encode(sticker, stickerWriter);
  stickerWriter.uint32(TAG_CONTEXT_INFO).bytes(pairingContextInfo(sticker.fileSha256));
  stickerWriter.uint32(TAG_STICKER_AUDIO).bytes(audioWriter.finish());

  const inner = new Writer().uint32(TAG_MESSAGE_STICKER).bytes(stickerWriter.finish()).finish();
  return new Writer().uint32(TAG_WRAPPER_MESSAGE).bytes(inner).finish();
}

// Call before relaying a message whose stickerMessage is `sticker`.
// `sticker.stickerSentTs` must be set and unique.
export function registerSoundSticker(sticker, audio) {
  pendingPayloads.set(String(sticker.stickerSentTs), buildPayload(sticker, audio));
  if (pendingPayloads.size > MAX_PENDING) {
    pendingPayloads.delete(pendingPayloads.keys().next().value);
  }
}
