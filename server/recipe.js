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
  // Busy, detailed videos (lots of texture or motion) need fewer frames.
  { quality: 10, fps: 6 },
  { quality: 5, fps: 5 },
  { quality: 0, fps: 4 },
];

const CLIP_FPS = 24;

// Read the uploaded file only as a local video container. Stops FFmpeg from
// treating a crafted file as a playlist or concat list that opens other
// files or URLs.
export const UPLOAD_INPUT_GUARD = [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'mov,matroska,avi',
];

// Same idea for a separate sound file: local audio containers only (MP3, M4A,
// Ogg/Opus, WAV, FLAC, AAC), plus video containers to take the sound of
// another video.
export const AUDIO_INPUT_GUARD = [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'mov,matroska,avi,mp3,ogg,wav,flac,aac',
];

// Photos: single image formats only (JPEG, PNG, WebP, GIF, BMP). The server
// always saves the photo as "foto.<extension>", a name with no % or wildcard,
// so the image2 reader cannot expand it into other files.
export const PHOTO_INPUT_GUARD = [
  '-protocol_whitelist', 'file',
  '-format_whitelist', 'image2,png_pipe,jpeg_pipe,webp_pipe,gif,bmp_pipe',
];

// WhatsApp accepts still stickers up to 100 KB; the margin leaves room for
// the pack metadata.
export const PHOTO_LIMIT_KB = 96;
export const PHOTO_QUALITIES = [85, 70, 55, 40, 25, 10];

// Where the separate sound starts, so that at least a moment of it is left.
export function clampAudioStart(start, total) {
  const length = Number.isFinite(total) && total > 0 ? total : 0;
  return round(Math.min(Math.max(0, Number(start) || 0), Math.max(0, length - MIN_SECONDS)));
}

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
// audio: optional { file, start } to use a separate sound instead of the
// video's own, cut to the same length from its own start time.
export function clipArgs({ input, output, start, duration, fit, audio }) {
  const soundInput = audio
    ? [...AUDIO_INPUT_GUARD, '-ss', String(audio.start), '-t', String(duration), '-i', audio.file]
    : [];
  return [
    ...UPLOAD_INPUT_GUARD,
    '-ss', String(start), '-t', String(duration), '-i', input,
    ...soundInput,
    // Capital V skips cover art stored as a video stream.
    '-map', '0:V:0', '-map', audio ? '1:a:0' : '0:a:0?',
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

// Still sticker from a photo: one 512 square WebP frame. Run the qualities in
// order until one fits the limit.
export function photoArgs({ input, output, fit, quality }) {
  return [
    ...PHOTO_INPUT_GUARD,
    '-i', input,
    '-frames:v', '1', '-vf', frameFilter(fit),
    '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6',
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
