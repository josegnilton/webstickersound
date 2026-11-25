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
};

const MIN_SECONDS = 0.5;
const DEFAULT_SECONDS = 5;
const REBUILD_DELAY_MS = 500;
const STATUS_INTERVAL_MS = 1500;

const state = {
  whatsapp: { state: 'off' },
  video: null, // { duration, hasAudio, maxSeconds }
  peaks: null,
  start: 0,
  length: DEFAULT_SECONDS,
  sticker: null, // { start, duration, kb, audioSeconds }
  building: false,
  rebuildQueued: false,
  sending: false,
};
let rebuildTimer = null;
let videoUrl = null;

// ---------- Helpers ----------

async function api(path, { method = 'GET', json, body } = {}) {
  const headers = { 'x-figuraudio': '1' };
  if (json) headers['content-type'] = 'application/json';
  const response = await fetch(path, { method, headers, body: json ? JSON.stringify(json) : body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
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
    if (!status.ffmpeg) showBanner('FFmpeg não foi encontrado neste computador. Instale e abra o Figuráudio de novo (passo 1 do README).');
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
  const file = event.dataTransfer?.files?.[0];
  if (file) loadVideo(file);
});

async function loadVideo(file) {
  if (!file) return;
  el.fileInput.value = '';
  if (state.building) return;
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
  state.peaks = null;
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

  if (state.video.hasAudio) {
    const { peaks } = await readWaveform(file);
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
  if (rebuild) scheduleBuild();
}

function renderTrim() {
  const total = state.video.duration;
  const left = (state.start / total) * 100;
  const width = (state.length / total) * 100;
  el.selection.style.left = `${left}%`;
  el.selection.style.width = `${width}%`;
  el.dimLeft.style.width = `${left}%`;
  el.dimRight.style.width = `${Math.max(0, 100 - left - width)}%`;
  if (document.activeElement !== el.start) el.start.value = state.start.toFixed(1);
  if (document.activeElement !== el.duration) el.duration.value = state.length.toFixed(1);
  el.start.max = Math.max(0, total - MIN_SECONDS).toFixed(1);
  el.duration.max = Math.min(state.video.maxSeconds, total).toFixed(1);
  el.frameGuide.hidden = fit() !== 'cover';
  if (el.video.paused) {
    el.playhead.style.left = `${left}%`;
    if (el.video.readyState >= 1) el.video.currentTime = state.start;
  }
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
  const canvas = el.wave;
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
    if (state.peaks) {
      const from = Math.floor((i / bars) * state.peaks.length);
      const to = Math.max(from + 1, Math.floor(((i + 1) / bars) * state.peaks.length));
      level = 0;
      for (let j = from; j < to; j++) level = Math.max(level, state.peaks[j]);
      level = Math.max(0.06, level);
    }
    const barHeight = level * (height - 12);
    ctx.fillRect(i * 4 + 1, (height - barHeight) / 2, 2, barHeight);
  }
}
window.addEventListener('resize', () => state.video && drawWave());

// Pointer: drag the selection, either edge, or tap the bar to jump there.
el.timeline.addEventListener('pointerdown', (event) => {
  if (!state.video) return;
  event.preventDefault();
  const rect = el.timeline.getBoundingClientRect();
  const toTime = (x) => ((x - rect.left) / rect.width) * state.video.duration;
  const handle = event.target.dataset?.handle;
  const onSelection = event.target === el.selection;
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
    scheduleBuild();
  });
}

// ---------- Listening to the piece ----------

function pausePreview() {
  el.video.pause();
  el.listen.setAttribute('aria-pressed', 'false');
}

el.listen.addEventListener('click', () => {
  if (!el.video.paused) return pausePreview();
  el.video.currentTime = state.start;
  el.video.play();
  el.listen.setAttribute('aria-pressed', 'true');
});

el.video.addEventListener('timeupdate', () => {
  if (!state.video) return;
  if (el.video.currentTime >= state.start + state.length || el.video.currentTime < state.start - 0.3) {
    el.video.currentTime = state.start;
  }
});

function trackPlayhead() {
  if (state.video && !el.video.paused) {
    el.playhead.style.left = `${(el.video.currentTime / state.video.duration) * 100}%`;
  }
  requestAnimationFrame(trackPlayhead);
}
requestAnimationFrame(trackPlayhead);

// ---------- Building the sticker ----------

function scheduleBuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(build, REBUILD_DELAY_MS);
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
      json: { start: state.start, duration: state.length, fit: fit() },
    });
    const version = Date.now();
    el.stickerImage.src = `/api/arquivo/figurinha.webp?v=${version}`;
    el.stickerAudio.src = state.sticker.audioSeconds ? `/api/arquivo/som.ogg?v=${version}` : '';
    setStatus(el.stickerStatus, state.sticker.audioSeconds
      ? 'Toque na figurinha para ouvir.'
      : 'Esse vídeo não tem som. Dá para baixar a figurinha, mas ela sai muda.');
  } catch (error) {
    state.sticker = null;
    setStatus(el.stickerStatus, error.message, 'error');
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
  const ready = Boolean(state.sticker?.audioSeconds) && !state.building;
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
