import { readWaveform } from './js/waveform.js';

const $ = (id) => document.getElementById(id);
const el = {
  banner: $('banner'),
  waStatus: $('wa-status'),
  waStatusText: $('wa-status-text'),
  drop: $('drop'),
  fileInput: $('file-input'),
  choose: $('choose-button'),
  editor: $('editor'),
  video: $('video'),
  frameGuide: $('frame-guide'),
  fileName: $('file-name'),
  replace: $('replace-button'),
  timeline: $('timeline'),
  wave: $('wave'),
  dimLeft: $('dim-left'),
  dimRight: $('dim-right'),
  selection: $('selection'),
  playhead: $('playhead'),
  ticks: $('ticks'),
  start: $('start'),
  duration: $('duration'),
  listen: $('listen-button'),
  square: $('square'),
  squareEmpty: $('square-empty'),
  stickerImage: $('sticker-image'),
  play: $('play-button'),
  badge: $('badge'),
  working: $('working'),
  stickerAudio: $('sticker-audio'),
  stickerStatus: $('sticker-status'),
  send: $('send-button'),
  sendStatus: $('send-status'),
  packName: $('pack-name'),
  packAuthor: $('pack-author'),
  downloads: $('downloads'),
  audioDownload: $('audio-download'),
  disconnect: $('disconnect-button'),
  qrDialog: $('qr-dialog'),
  qrImage: $('qr-image'),
  qrWaiting: $('qr-waiting'),
  qrClose: $('qr-close'),
  qrNew: $('qr-new'),
  soundInput: $('sound-input'),
  soundName: $('sound-name'),
  soundChoose: $('sound-choose'),
  soundRemove: $('sound-remove'),
  soundEditor: $('sound-editor'),
  soundTimeline: $('sound-timeline'),
  soundWave: $('sound-wave'),
  soundDimLeft: $('sound-dim-left'),
  soundDimRight: $('sound-dim-right'),
  soundSelection: $('sound-selection'),
  soundTicks: $('sound-ticks'),
  soundStart: $('sound-start'),
  soundAudio: $('sound-audio'),
};

const MIN_SECONDS = 0.5;
// Past this length, decoding the whole sound for the waveform can run the
// browser tab out of memory.
const MAX_WAVEFORM_SECONDS = 600;
const BUSY_RETRY_MS = 1500;
const NARROW_SELECTION_PX = 48;
const NARROW_GRAB_PX = 12;
const DEFAULT_SECONDS = 5;
const REBUILD_DELAY_MS = 500;
const STATUS_INTERVAL_MS = 1500;

const state = {
  whatsapp: { state: 'off' },
  video: null, // { duration, hasAudio, maxSeconds }
  peaks: null,
  start: 0,
  length: DEFAULT_SECONDS,
  track: null, // separate sound: { name, duration }
  trackPeaks: null,
  audioStart: 0,
  sticker: null, // { start, duration, kb, audioSeconds, audioStart }
  stale: false, // trim or framing changed since the sticker was built
  loadId: 0,
  building: false,
  rebuildQueued: false,
  sending: false,
};
let rebuildTimer = null;
let videoUrl = null;
let trackUrl = null;
let trackLoadId = 0;

// ---------- Helpers ----------

async function api(path, { method = 'GET', json, body } = {}) {
  const headers = { 'x-figuraudio': '1' };
  if (json) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(path, { method, headers, body: json ? JSON.stringify(json) : body });
  } catch {
    throw new Error('Sem resposta do Figuráudio. Ele ainda está aberto?');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Erro ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

const seconds = (value) => `${Number(value).toFixed(1).replace('.', ',')} s`;
const round1 = (value) => Math.round(value * 10) / 10;
const fit = () => document.querySelector('input[name="fit"]:checked').value;

function setStatus(node, message, kind = '') {
  node.textContent = message;
  node.className = `status ${kind}`.trim();
}

function showBanner(message) {
  el.banner.textContent = message || '';
  el.banner.hidden = !message;
}

// ---------- WhatsApp ----------

function renderWhatsApp() {
  const wa = state.whatsapp;
  el.waStatus.dataset.state = wa.state;
  const labels = {
    off: 'WhatsApp desconectado',
    connecting: 'Conectando ao WhatsApp…',
    qr: 'Aguardando a leitura do QR Code',
  };
  el.waStatusText.textContent = wa.state === 'open' ? `WhatsApp conectado (${maskNumber(wa.me)})` : labels[wa.state];
  el.disconnect.hidden = wa.state !== 'open';

  if (wa.state === 'qr' && wa.qr) {
    el.qrImage.src = wa.qr;
    el.qrImage.hidden = false;
    el.qrWaiting.hidden = true;
  } else {
    el.qrImage.hidden = true;
    el.qrWaiting.hidden = false;
    el.qrWaiting.textContent = wa.note || 'Gerando o código…';
  }
  el.qrNew.disabled = wa.state === 'connecting';
  if (wa.state === 'open' && el.qrDialog.open) el.qrDialog.close();
  renderSend();
}

function maskNumber(number) {
  const digits = String(number || '');
  return digits.length > 4 ? `final ${digits.slice(-4)}` : digits;
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    state.whatsapp = status.whatsapp;
    if (!status.ffmpeg) showBanner(status.ffmpegProblem || 'FFmpeg não foi encontrado. Veja o passo 1 do README.');
    else if (el.banner.dataset.kind === 'closed') showBanner('');
    el.banner.dataset.kind = status.ffmpeg ? '' : 'ffmpeg';
    renderWhatsApp();
  } catch {
    el.banner.dataset.kind = 'closed';
    showBanner('O Figuráudio foi fechado. Abra o programa de novo e recarregue esta página.');
  }
}

async function connectWhatsApp() {
  el.qrDialog.showModal();
  try {
    if (state.whatsapp.state === 'off') state.whatsapp = await api('/api/whatsapp/conectar', { method: 'POST' });
    renderWhatsApp();
  } catch (error) {
    el.qrWaiting.textContent = error.message;
  }
}

el.qrClose.addEventListener('click', () => el.qrDialog.close());

// Starts the linking over: useful when the phone could not link or the code expired.
el.qrNew.addEventListener('click', async () => {
  el.qrImage.hidden = true;
  el.qrWaiting.hidden = false;
  el.qrWaiting.textContent = 'Gerando um código novo…';
  el.qrNew.disabled = true;
  try {
    state.whatsapp = await api('/api/whatsapp/novo-qr', { method: 'POST' });
    renderWhatsApp();
  } catch (error) {
    el.qrWaiting.textContent = error.message;
    el.qrNew.disabled = false;
  }
});

el.disconnect.addEventListener('click', async () => {
  const ok = confirm('Desconectar o WhatsApp deste computador? A conexão salva é apagada e você vai precisar ler o QR Code de novo.');
  if (!ok) return;
  try {
    state.whatsapp = await api('/api/whatsapp/desconectar', { method: 'POST' });
    renderWhatsApp();
  } catch (error) {
    setStatus(el.sendStatus, error.message, 'error');
  }
});

// ---------- Choosing the video ----------

el.choose.addEventListener('click', () => el.fileInput.click());
el.replace.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => loadVideo(el.fileInput.files[0]));

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    el.drop.classList.add('dragging');
  });
}
document.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) el.drop.classList.remove('dragging');
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  el.drop.classList.remove('dragging');
  loadDropped([...(event.dataTransfer?.files || [])]);
});

const isAudioFile = (file) => file.type.startsWith('audio/') || /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i.test(file.name);

// A video and a sound can be dropped together; a sound alone replaces the
// sound of the video already chosen.
async function loadDropped(files) {
  const sound = files.find(isAudioFile);
  const videoFile = files.find((file) => !isAudioFile(file));
  if (videoFile) await loadVideo(videoFile);
  if (!sound) return;
  if (!state.video) {
    showBanner('Escolha o vídeo primeiro. Depois traga o áudio.');
    return;
  }
  loadTrack(sound);
}

async function loadVideo(file) {
  if (!file) return;
  el.fileInput.value = '';
  if (state.building || state.sending) {
    showBanner('Aguarde a figurinha atual terminar e escolha o vídeo de novo.');
    return;
  }
  showBanner('');
  setStatus(el.stickerStatus, '');
  setStatus(el.sendStatus, '');
  pausePreview();

  el.drop.classList.add('loading');
  el.choose.textContent = 'Carregando o vídeo…';
  try {
    state.video = await api(`/api/video?nome=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  } catch (error) {
    showBanner(error.message);
    return;
  } finally {
    el.drop.classList.remove('loading');
    el.choose.textContent = 'Escolher vídeo';
  }

  state.sticker = null;
  state.stale = false;
  state.peaks = null;
  const loadId = ++state.loadId;
  state.start = 0;
  state.length = Math.min(DEFAULT_SECONDS, state.video.maxSeconds, state.video.duration);
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = URL.createObjectURL(file);
  el.video.src = videoUrl;
  el.fileName.textContent = file.name;
  el.drop.hidden = true;
  el.editor.hidden = false;
  renderTrim();
  renderTicks();
  drawWave();
  renderSticker();
  build();

  if (state.video.hasAudio && state.video.duration <= MAX_WAVEFORM_SECONDS) {
    const { peaks } = await readWaveform(file);
    // Another video may have been chosen while this one was decoding.
    if (loadId !== state.loadId) return;
    state.peaks = peaks;
    drawWave();
  }
}

// ---------- Trimming ----------

function clampTrim(start, length) {
  const total = state.video.duration;
  const maxLength = Math.min(state.video.maxSeconds, total);
  const nextLength = Math.min(Math.max(MIN_SECONDS, length), maxLength);
  const nextStart = Math.min(Math.max(0, start), Math.max(0, total - nextLength));
  return { start: round1(nextStart), length: round1(nextLength) };
}

function setTrim(start, length, { rebuild = true } = {}) {
  const next = clampTrim(start, length);
  if (next.start === state.start && next.length === state.length) return;
  state.start = next.start;
  state.length = next.length;
  renderTrim();
  if (!el.video.paused) el.video.currentTime = state.start;
  if (rebuild) markStale();
}

function renderTrim() {
  const total = state.video.duration;
  const left = (state.start / total) * 100;
  const width = (state.length / total) * 100;
  el.selection.style.left = `${left}%`;
  el.selection.style.width = `${width}%`;
  el.dimLeft.style.width = `${left}%`;
  el.dimRight.style.width = `${Math.max(0, 100 - left - width)}%`;
  el.selection.classList.toggle('narrow', isNarrowSelection());
  if (document.activeElement !== el.start) el.start.value = state.start.toFixed(1);
  if (document.activeElement !== el.duration) el.duration.value = state.length.toFixed(1);
  el.start.max = Math.max(0, total - MIN_SECONDS).toFixed(1);
  el.duration.max = Math.min(state.video.maxSeconds, total).toFixed(1);
  el.frameGuide.hidden = fit() !== 'cover';
  renderSound();
  if (el.video.paused) {
    el.playhead.style.left = `${left}%`;
    if (el.video.readyState >= 1) el.video.currentTime = state.start;
  }
}

// Narrower than this, the edges cannot be told apart from the middle.
function isNarrowSelection() {
  const width = el.timeline.getBoundingClientRect().width;
  return width > 0 && (state.length / state.video.duration) * width < NARROW_SELECTION_PX;
}

function renderTicks() {
  const total = state.video.duration;
  const steps = 6;
  el.ticks.replaceChildren(...Array.from({ length: steps + 1 }, (_, i) => {
    const span = document.createElement('span');
    const value = (total * i) / steps;
    span.textContent = total >= 20 ? `${Math.round(value)} s` : seconds(value);
    return span;
  }));
}

function drawWave() {
  drawBars(el.wave, state.peaks);
}

function drawBars(canvas, peaks) {
  const ratio = window.devicePixelRatio || 1;
  const { width, height } = canvas.getBoundingClientRect();
  if (!width) return;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#9ca3af';
  const bars = Math.floor(width / 4);
  for (let i = 0; i < bars; i++) {
    let level = 0.12;
    if (peaks) {
      const from = Math.floor((i / bars) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * peaks.length));
      level = 0;
      for (let j = from; j < to; j++) level = Math.max(level, peaks[j]);
      level = Math.max(0.06, level);
    }
    const barHeight = level * (height - 12);
    ctx.fillRect(i * 4 + 1, (height - barHeight) / 2, 2, barHeight);
  }
}
window.addEventListener('resize', () => {
  if (state.video) {
    drawWave();
    el.selection.classList.toggle('narrow', isNarrowSelection());
  }
  if (state.track) drawBars(el.soundWave, state.trackPeaks);
});

// Pointer: drag the selection, either edge, or tap the bar to jump there.
el.timeline.addEventListener('pointerdown', (event) => {
  if (!state.video) return;
  event.preventDefault();
  const rect = el.timeline.getBoundingClientRect();
  const toTime = (x) => ((x - rect.left) / rect.width) * state.video.duration;
  // In a long video the selection is only a few pixels wide and its edges
  // would cover it: then any grab near it moves it instead of resizing.
  const narrow = isNarrowSelection();
  const box = el.selection.getBoundingClientRect();
  const nearSelection = event.clientX >= box.left - NARROW_GRAB_PX && event.clientX <= box.right + NARROW_GRAB_PX;
  const handle = narrow ? null : event.target.dataset?.handle;
  const onSelection = narrow ? nearSelection : event.target === el.selection;
  const grabOffset = toTime(event.clientX) - state.start;
  const end = state.start + state.length;

  if (!handle && !onSelection) setTrim(toTime(event.clientX) - state.length / 2, state.length);

  el.timeline.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    const time = toTime(moveEvent.clientX);
    if (handle === 'start') {
      // The end stays put; the start moves within 0.5 to 10 s of it.
      const earliest = Math.max(0, end - state.video.maxSeconds);
      const start = Math.min(Math.max(time, earliest), end - MIN_SECONDS);
      setTrim(start, end - start);
    } else if (handle === 'end') {
      setTrim(state.start, time - state.start);
    } else {
      setTrim(onSelection ? time - grabOffset : time - state.length / 2, state.length);
    }
  };
  const up = () => {
    el.timeline.removeEventListener('pointermove', move);
    el.timeline.removeEventListener('pointerup', up);
    el.timeline.removeEventListener('pointercancel', up);
  };
  el.timeline.addEventListener('pointermove', move);
  el.timeline.addEventListener('pointerup', up);
  el.timeline.addEventListener('pointercancel', up);
});

el.start.addEventListener('change', () => setTrim(Number(el.start.value), state.length));
el.duration.addEventListener('change', () => setTrim(state.start, Number(el.duration.value)));
el.start.addEventListener('blur', renderTrim);
el.duration.addEventListener('blur', renderTrim);
for (const radio of document.querySelectorAll('input[name="fit"]')) {
  radio.addEventListener('change', () => {
    renderTrim();
    markStale();
  });
}

// ---------- Listening to the piece ----------

function pausePreview() {
  el.video.pause();
  el.soundAudio.pause();
  el.listen.setAttribute('aria-pressed', 'false');
}

// With a separate sound, the video plays muted and the sound plays along.
function restartPreview() {
  el.video.currentTime = state.start;
  if (state.track) el.soundAudio.currentTime = state.audioStart;
}

el.listen.addEventListener('click', () => {
  if (!el.video.paused) return pausePreview();
  el.video.muted = Boolean(state.track);
  restartPreview();
  el.video.play();
  if (state.track) el.soundAudio.play();
  el.listen.setAttribute('aria-pressed', 'true');
});

el.video.addEventListener('timeupdate', () => {
  if (!state.video) return;
  if (el.video.currentTime >= state.start + state.length || el.video.currentTime < state.start - 0.3) {
    restartPreview();
  }
});

function trackPlayhead() {
  if (state.video && !el.video.paused) {
    el.playhead.style.left = `${(el.video.currentTime / state.video.duration) * 100}%`;
  }
  requestAnimationFrame(trackPlayhead);
}
requestAnimationFrame(trackPlayhead);

// ---------- Separate sound ----------

el.soundChoose.addEventListener('click', () => el.soundInput.click());
el.soundInput.addEventListener('change', () => loadTrack(el.soundInput.files[0]));

async function loadTrack(file) {
  if (!file) return;
  el.soundInput.value = '';
  if (state.sending) {
    showBanner('Aguarde o envio terminar e escolha o áudio de novo.');
    return;
  }
  // The server takes one job at a time: let the sticker being made finish.
  el.soundName.textContent = 'Carregando o áudio…';
  while (state.building) await new Promise((resolve) => setTimeout(resolve, 200));
  showBanner('');
  pausePreview();
  el.soundChoose.disabled = true;
  el.soundName.textContent = 'Carregando o áudio…';
  let track;
  try {
    track = await api(`/api/audio?nome=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  } catch (error) {
    // The previous sound, if any, stays in use.
    showBanner(error.message);
    renderSound();
    return;
  } finally {
    el.soundChoose.disabled = false;
  }

  const loadId = ++trackLoadId;
  state.track = { name: file.name, duration: track.duration };
  state.trackPeaks = null;
  state.audioStart = 0;
  if (trackUrl) URL.revokeObjectURL(trackUrl);
  trackUrl = URL.createObjectURL(file);
  el.soundAudio.src = trackUrl;
  renderSound();
  renderSoundTicks();
  drawBars(el.soundWave, null);
  markStale();

  if (track.duration <= MAX_WAVEFORM_SECONDS) {
    const { peaks } = await readWaveform(file);
    // Another sound may have been chosen while this one was decoding.
    if (loadId !== trackLoadId || !state.track) return;
    state.trackPeaks = peaks;
    drawBars(el.soundWave, peaks);
  }
}

function clearTrack() {
  trackLoadId++;
  state.track = null;
  state.trackPeaks = null;
  state.audioStart = 0;
  el.soundAudio.removeAttribute('src');
  if (trackUrl) URL.revokeObjectURL(trackUrl);
  trackUrl = null;
  el.video.muted = false;
  renderSound();
}

el.soundRemove.addEventListener('click', async () => {
  if (state.building || state.sending) {
    showBanner('Aguarde a figurinha atual terminar.');
    return;
  }
  pausePreview();
  try {
    await api('/api/audio/remover', { method: 'POST' });
  } catch (error) {
    showBanner(error.message);
    return;
  }
  clearTrack();
  markStale();
});

// The window over the sound is as long as the piece of video.
function soundWindow() {
  return Math.min(state.length, state.track.duration);
}

function clampAudioStart(value) {
  const latest = Math.max(0, state.track.duration - soundWindow());
  return round1(Math.min(Math.max(0, value), latest));
}

function setAudioStart(value) {
  const next = clampAudioStart(value);
  if (next === state.audioStart) return;
  state.audioStart = next;
  renderSound();
  if (!el.video.paused) restartPreview();
  markStale();
}

function renderSound() {
  const { track } = state;
  el.soundEditor.hidden = !track;
  el.soundRemove.hidden = !track;
  el.soundChoose.textContent = track ? 'Trocar áudio' : 'Usar outro áudio';
  if (!track) {
    el.soundName.textContent = state.video && !state.video.hasAudio ? 'O vídeo não tem som' : 'O do próprio vídeo';
    return;
  }
  el.soundName.textContent = track.name;
  // A longer piece of video can push the window past the end of the sound.
  state.audioStart = clampAudioStart(state.audioStart);
  const left = (state.audioStart / track.duration) * 100;
  const width = (soundWindow() / track.duration) * 100;
  el.soundSelection.style.left = `${left}%`;
  el.soundSelection.style.width = `${width}%`;
  el.soundDimLeft.style.width = `${left}%`;
  el.soundDimRight.style.width = `${Math.max(0, 100 - left - width)}%`;
  el.soundStart.max = Math.max(0, track.duration - soundWindow()).toFixed(1);
  if (document.activeElement !== el.soundStart) el.soundStart.value = state.audioStart.toFixed(1);
}

function renderSoundTicks() {
  const total = state.track.duration;
  const steps = 6;
  el.soundTicks.replaceChildren(...Array.from({ length: steps + 1 }, (_, i) => {
    const span = document.createElement('span');
    const value = (total * i) / steps;
    span.textContent = total >= 20 ? `${Math.round(value)} s` : seconds(value);
    return span;
  }));
}

// Drag the window over the sound, or tap the bar to jump there.
el.soundTimeline.addEventListener('pointerdown', (event) => {
  if (!state.track) return;
  event.preventDefault();
  const rect = el.soundTimeline.getBoundingClientRect();
  const toTime = (x) => ((x - rect.left) / rect.width) * state.track.duration;
  const onSelection = event.target === el.soundSelection;
  const grabOffset = toTime(event.clientX) - state.audioStart;
  if (!onSelection) setAudioStart(toTime(event.clientX) - soundWindow() / 2);

  el.soundTimeline.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    const time = toTime(moveEvent.clientX);
    setAudioStart(onSelection ? time - grabOffset : time - soundWindow() / 2);
  };
  const up = () => {
    el.soundTimeline.removeEventListener('pointermove', move);
    el.soundTimeline.removeEventListener('pointerup', up);
    el.soundTimeline.removeEventListener('pointercancel', up);
  };
  el.soundTimeline.addEventListener('pointermove', move);
  el.soundTimeline.addEventListener('pointerup', up);
  el.soundTimeline.addEventListener('pointercancel', up);
});

el.soundStart.addEventListener('change', () => setAudioStart(Number(el.soundStart.value)));
el.soundStart.addEventListener('blur', renderSound);

// ---------- Building the sticker ----------

// The sticker no longer matches the controls: block sending until rebuilt.
function markStale() {
  if (state.sticker) state.stale = true;
  renderSend();
  scheduleBuild();
}

function scheduleBuild(delay = REBUILD_DELAY_MS) {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(build, delay);
}

async function build() {
  if (!state.video) return;
  if (state.building) {
    state.rebuildQueued = true;
    return;
  }
  state.building = true;
  setStatus(el.sendStatus, '');
  renderSticker();
  try {
    state.sticker = await api('/api/figurinha', {
      method: 'POST',
      json: { start: state.start, duration: state.length, fit: fit(), audioStart: state.audioStart },
    });
    state.stale = false;
    const version = Date.now();
    el.stickerImage.src = `/api/arquivo/figurinha.webp?v=${version}`;
    el.stickerAudio.src = state.sticker.audioSeconds ? `/api/arquivo/som.ogg?v=${version}` : '';
    setStatus(el.stickerStatus, state.sticker.audioSeconds
      ? 'Toque na figurinha para ouvir.'
      : 'Esse vídeo não tem som. Use outro áudio no passo 1 ou baixe a figurinha muda.');
  } catch (error) {
    if (error.status === 409) {
      // The server is still busy (sending, for example): try again shortly.
      scheduleBuild(BUSY_RETRY_MS);
    } else {
      state.sticker = null;
      setStatus(el.stickerStatus, error.message, 'error');
    }
  } finally {
    state.building = false;
    renderSticker();
    if (state.rebuildQueued) {
      state.rebuildQueued = false;
      build();
    }
  }
}

function renderSticker() {
  const { sticker, building } = state;
  el.square.classList.toggle('updating', building);
  el.working.hidden = !building;
  el.squareEmpty.hidden = Boolean(sticker) || building;
  el.stickerImage.hidden = !sticker;
  el.play.hidden = !sticker?.audioSeconds || building;
  el.badge.hidden = !sticker;
  if (sticker) el.badge.textContent = seconds(sticker.duration);
  el.downloads.hidden = !sticker;
  el.audioDownload.hidden = !sticker?.audioSeconds;
  renderSend();
}

// Restart the animation together with the sound, as WhatsApp does on tap.
el.play.addEventListener('click', () => {
  const src = el.stickerImage.src.replace(/&play=\d+$/, '');
  el.stickerImage.src = `${src}&play=${Date.now()}`;
  el.stickerAudio.currentTime = 0;
  el.stickerAudio.play();
});

// ---------- Sending ----------

function renderSend() {
  const connected = state.whatsapp.state === 'open';
  const ready = Boolean(state.sticker?.audioSeconds) && !state.building && !state.stale;
  if (!connected) {
    const labels = { off: 'Conectar o WhatsApp', qr: 'Mostrar o QR Code', connecting: 'Conectando…' };
    el.send.textContent = labels[state.whatsapp.state];
    el.send.disabled = state.whatsapp.state === 'connecting';
  } else {
    el.send.textContent = state.sending ? 'Enviando…' : 'Enviar para o meu WhatsApp';
    el.send.disabled = !ready || state.sending;
  }
}

el.send.addEventListener('click', async () => {
  if (state.whatsapp.state !== 'open') return connectWhatsApp();
  state.sending = true;
  setStatus(el.sendStatus, '');
  renderSend();
  try {
    await api('/api/enviar', {
      method: 'POST',
      json: { packName: el.packName.value, author: el.packAuthor.value },
    });
    setStatus(el.sendStatus, 'Enviada. Abra a conversa com você mesmo no WhatsApp e salve a figurinha nos favoritos.', 'ok');
  } catch (error) {
    setStatus(el.sendStatus, error.message, 'error');
  } finally {
    state.sending = false;
    renderSend();
  }
});

refreshStatus();
setInterval(refreshStatus, STATUS_INTERVAL_MS);
