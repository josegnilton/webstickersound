// FFmpeg argument lists for every conversion step. Pure functions, so the
// tests run exactly the commands the server runs.

export const SIZE = 512;
export const MAX_SECONDS = 10;
export const MIN_SECONDS = 0.5;
// WhatsApp accepts animated stickers up to 500 KB; the margin leaves room for
// the pack metadata added before sending.
export const STICKER_LIMIT_KB = 480;
export const STICKER_STEPS = [
  { quality: 60, fps: 15 },
  { quality: 45, fps: 15 },
  { quality: 35, fps: 12 },
  { quality: 25, fps: 12 },
  { quality: 15, fps: 10 },
  { quality: 8, fps: 8 },
];

const CLIP_FPS = 24;

export function clampTrim(start, duration, total) {
  const length = Number.isFinite(total) && total > 0 ? total : MAX_SECONDS;
  const from = Math.min(Math.max(0, Number(start) || 0), Math.max(0, length - MIN_SECONDS));
  const seconds = Math.min(Math.max(MIN_SECONDS, Number(duration) || MAX_SECONDS), MAX_SECONDS, length - from);
  return { start: round(from), duration: round(Math.max(MIN_SECONDS, seconds)) };
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function frameFilter(fit) {
  if (fit === 'contain') {
    return `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease:flags=lanczos,` +
      `format=rgba,pad=${SIZE}:${SIZE}:(ow-iw)/2:(oh-ih)/2:color=0x00000000`;
  }
  return `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=increase:flags=lanczos,crop=${SIZE}:${SIZE},format=rgba`;
}

// Step 1: decode the source once. Cut the piece, frame it as a 512 square with
// alpha, and keep the sound uncompressed, so the next steps read a small file.
export function clipArgs({ input, output, start, duration, fit }) {
  return [
    '-ss', String(start), '-t', String(duration), '-i', input,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', `fps=${CLIP_FPS},${frameFilter(fit)}`,
    '-c:v', 'png', '-c:a', 'pcm_s16le', '-ar', '48000',
    output,
  ];
}

// Animated WebP sticker. Run the steps in order until one fits the limit.
export function stickerArgs({ input, output, quality, fps }) {
  return [
    '-i', input, '-an',
    '-vf', `fps=${fps}`,
    '-c:v', 'libwebp_anim', '-q:v', String(quality), '-compression_level', '4',
    '-loop', '0',
    output,
  ];
}

// Mono Opus in Ogg, the codec of WhatsApp audio.
export function audioArgs({ input, output }) {
  return [
    '-i', input, '-vn',
    '-c:a', 'libopus', '-application', 'voip', '-vbr', 'off',
    '-ac', '1', '-ar', '48000', '-b:a', '32k',
    output,
  ];
}
