// Reads the real audio of the chosen video and reduces it to bar heights.
// Returns null when the video has no sound the browser can decode.

// Decoding needs the whole file in memory; past this size the page skips the
// waveform instead of risking a crash on phones.
const MAX_DECODE_BYTES = 150 * 1024 * 1024;

export async function readWaveform(file, bars = 240) {
  if (file.size > MAX_DECODE_BYTES) return { peaks: null, tooLarge: true };
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return { peaks: null };
  const context = new AudioCtx();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
    const bucket = Math.max(1, Math.floor(buffer.length / bars));
    const peaks = new Float32Array(bars);
    let loudest = 0;
    for (let bar = 0; bar < bars; bar++) {
      let peak = 0;
      const from = bar * bucket;
      const to = Math.min(buffer.length, from + bucket);
      // Sampling every 16th value is plenty for a bar and keeps phones fast.
      for (let i = from; i < to; i += 16) {
        for (const data of channels) {
          const value = Math.abs(data[i]);
          if (value > peak) peak = value;
        }
      }
      peaks[bar] = peak;
      if (peak > loudest) loudest = peak;
    }
    if (loudest < 0.001) return { peaks: null, silent: true };
    for (let bar = 0; bar < bars; bar++) peaks[bar] /= loudest;
    return { peaks, duration: buffer.duration };
  } catch {
    return { peaks: null };
  } finally {
    context.close?.();
  }
}
