const $ = (id) => document.getElementById(id);

const el = {
  banner: $('banner'),
  waStatus: $('wa-status'),
  waStatusText: $('wa-status-text'),
  waButton: $('wa-button'),
  dropzone: $('dropzone'),
  fileInput: $('file-input'),
  editor: $('editor'),
  video: $('source-video'),
  start: $('start'),
  startValue: $('start-value'),
  duration: $('duration'),
  durationValue: $('duration-value'),
  replace: $('replace-button'),
  preview: $('preview'),
  previewEmpty: $('preview-empty'),
  previewProgress: $('preview-progress'),
  stickerButton: $('sticker-button'),
  stickerImage: $('sticker-image'),
  stickerAudio: $('sticker-audio'),
  meta: $('meta'),
  send: $('send'),
  sendButton: $('send-button'),
  sendHint: $('send-hint'),
  packName: $('pack-name'),
  author: $('author'),
  audioDownload: $('audio-download'),
  qrDialog: $('qr-dialog'),
  qrImage: $('qr-image'),
  qrWaiting: $('qr-waiting'),
  qrClose: $('qr-close'),
};

const DEFAULT_SECONDS = 5;
const REBUILD_DELAY_MS = 500;
const STATUS_INTERVAL_MS = 1500;

const state = {
  whatsapp: { state: 'off' },
  video: null, // { duration, hasAudio, maxSeconds }
  built: null, // { kb, seconds, audioSeconds }
  building: false,
  rebuildQueued: false,
  sending: false,
};
let rebuildTimer = null;
let videoUrl = null;

async function api(path, { method = 'GET', json, body } = {}) {
  const headers = { 'x-figsom': '1' };
  if (json) headers['content-type'] = 'application/json';
  const response = await fetch(path, { method, headers, body: json ? JSON.stringify(json) : body });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
  return data;
}

const seconds = (value) => `${Number(value).toFixed(1).replace('.', ',')} s`;

function showBanner(message) {
  el.banner.textContent = message || '';
  el.banner.hidden = !message;
}

// Status polling must not wipe an error the user has not read yet, so it only
// clears the banner when the banner is showing a status problem.
let statusProblem = '';
function showStatusProblem(message) {
  if (message === statusProblem) return;
  statusProblem = message;
  showBanner(message);
}

function setHint(message, kind = '') {
  el.sendHint.textContent = message;
  el.sendHint.className = `hint ${kind}`.trim();
}

// ---------- WhatsApp connection ----------

const WA_LABELS = {
  off: 'WhatsApp desconectado',
  connecting: 'Conectando…',
  qr: 'Aguardando leitura do QR Code',
};

function renderWhatsApp() {
  const wa = state.whatsapp;
  el.waStatus.dataset.state = wa.state;
  el.waStatusText.textContent = wa.state === 'open' ? `Conectado: +${wa.me}` : WA_LABELS[wa.state];
  el.waButton.hidden = false;
  el.waButton.textContent = wa.state === 'open' ? 'Desconectar' : 'Conectar WhatsApp';
  el.waButton.disabled = wa.state === 'connecting';

  if (wa.state === 'qr' && wa.qr) {
    el.qrImage.src = wa.qr;
    el.qrImage.hidden = false;
    el.qrWaiting.hidden = true;
  } else {
    el.qrImage.hidden = true;
    el.qrWaiting.hidden = false;
    el.qrWaiting.textContent = wa.note || 'Gerando o código…';
  }
  if (wa.state === 'open' && el.qrDialog.open) el.qrDialog.close();
  renderSend();
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    state.whatsapp = status.whatsapp;
    showStatusProblem(status.ffmpeg ? '' : 'FFmpeg não encontrado. Instale com "winget install Gyan.FFmpeg" e abra o FigSom de novo.');
    renderWhatsApp();
  } catch {
    showStatusProblem('O FigSom foi fechado. Abra o programa de novo e recarregue esta página.');
  }
}

el.waButton.addEventListener('click', async () => {
  try {
    if (state.whatsapp.state === 'open') {
      if (!confirm('Desconectar o WhatsApp deste computador?')) return;
      state.whatsapp = await api('/api/whatsapp/logout', { method: 'POST' });
    } else {
      el.qrDialog.showModal();
      if (state.whatsapp.state === 'off') state.whatsapp = await api('/api/whatsapp/connect', { method: 'POST' });
    }
    renderWhatsApp();
  } catch (error) {
    showBanner(error.message);
  }
});
el.qrClose.addEventListener('click', () => el.qrDialog.close());

// ---------- Video upload ----------

async function uploadVideo(file) {
  if (!file) return;
  showBanner('');
  el.dropzone.classList.add('loading');
  el.dropzone.querySelector('strong').textContent = 'Enviando o vídeo…';
  try {
    state.video = await api(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    state.built = null;

    if (videoUrl) URL.revokeObjectURL(videoUrl);
    videoUrl = URL.createObjectURL(file);
    el.video.src = videoUrl;

    const { duration, maxSeconds } = state.video;
    el.start.max = Math.max(0, duration - 0.5).toFixed(1);
    el.start.value = 0;
    el.duration.max = Math.min(maxSeconds, duration).toFixed(1);
    el.duration.value = Math.min(DEFAULT_SECONDS, duration).toFixed(1);
    document.querySelector('input[name="fit"][value="cover"]').checked = true;

    el.dropzone.hidden = true;
    el.editor.hidden = false;
    renderTrim();
    build();
  } catch (error) {
    showBanner(error.message);
  } finally {
    el.dropzone.classList.remove('loading');
    el.dropzone.querySelector('strong').textContent = 'Arraste um vídeo aqui';
    el.fileInput.value = '';
  }
}

el.fileInput.addEventListener('change', () => uploadVideo(el.fileInput.files[0]));
el.replace.addEventListener('click', () => el.fileInput.click());

for (const type of ['dragenter', 'dragover']) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropzone.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop']) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    el.dropzone.classList.remove('dragging');
  });
}
document.addEventListener('drop', (event) => uploadVideo(event.dataTransfer?.files[0]));

// ---------- Trim and build ----------

function renderTrim() {
  // The clip cannot run past the end of the video.
  const remaining = state.video.duration - Number(el.start.value);
  el.duration.max = Math.max(0.5, Math.min(state.video.maxSeconds, remaining)).toFixed(1);
  el.startValue.textContent = seconds(el.start.value);
  el.durationValue.textContent = seconds(el.duration.value);
}

function scheduleBuild() {
  renderTrim();
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(build, REBUILD_DELAY_MS);
}

el.start.addEventListener('input', () => {
  el.video.currentTime = Number(el.start.value);
  scheduleBuild();
});
el.duration.addEventListener('input', scheduleBuild);
for (const radio of document.querySelectorAll('input[name="fit"]')) radio.addEventListener('change', scheduleBuild);

async function build() {
  if (!state.video) return;
  if (state.building) {
    state.rebuildQueued = true;
    return;
  }
  state.building = true;
  renderPreview();
  try {
    state.built = await api('/api/build', {
      method: 'POST',
      json: {
        start: Number(el.start.value),
        duration: Number(el.duration.value),
        fit: document.querySelector('input[name="fit"]:checked').value,
      },
    });
    const version = Date.now();
    el.stickerImage.src = `/api/out/sticker.webp?v=${version}`;
    el.stickerAudio.src = state.built.audioSeconds ? `/api/out/audio.ogg?v=${version}` : '';
    setHint('');
    showBanner('');
  } catch (error) {
    state.built = null;
    showBanner(error.message);
  } finally {
    state.building = false;
    renderPreview();
    if (state.rebuildQueued) {
      state.rebuildQueued = false;
      build();
    }
  }
}

function renderPreview() {
  const { built, building } = state;
  el.preview.classList.toggle('working', building);
  el.previewProgress.hidden = !building;
  el.previewEmpty.hidden = Boolean(built) || building;
  el.stickerButton.hidden = !built;
  el.meta.hidden = !built;
  el.send.hidden = !built;
  if (built) {
    const hasSound = built.audioSeconds > 0;
    el.meta.classList.toggle('warning', !hasSound);
    el.meta.textContent = hasSound
      ? `${built.kb} KB · ${seconds(built.seconds)} · clique na figurinha para ouvir`
      : 'Esse vídeo não tem som. Dá para baixar a figurinha, mas não enviar com áudio.';
    el.audioDownload.hidden = !hasSound;
  }
  renderSend();
}

// Restart the animation together with the sound, as WhatsApp does on tap.
el.stickerButton.addEventListener('click', () => {
  if (!state.built?.audioSeconds) return;
  const url = new URL(el.stickerImage.src);
  url.searchParams.set('play', Date.now());
  el.stickerImage.src = url.href;
  el.stickerAudio.currentTime = 0;
  el.stickerAudio.play();
});

// ---------- Send ----------

function renderSend() {
  const connected = state.whatsapp.state === 'open';
  const ready = Boolean(state.built?.audioSeconds) && !state.building;
  el.sendButton.disabled = !ready || !connected || state.sending;
  el.sendButton.textContent = state.sending ? 'Enviando…' : 'Enviar para o meu WhatsApp';
  if (ready && !connected && !el.sendHint.textContent) setHint('Conecte o WhatsApp no topo da página para enviar.');
  if (connected && el.sendHint.textContent.startsWith('Conecte')) setHint('');
}

el.sendButton.addEventListener('click', async () => {
  state.sending = true;
  setHint('');
  renderSend();
  try {
    await api('/api/send', { method: 'POST', json: { packName: el.packName.value, author: el.author.value } });
    setHint('Enviada. Abra a conversa com você mesmo no WhatsApp e salve nos favoritos.', 'ok');
  } catch (error) {
    setHint(error.message, 'error');
  } finally {
    state.sending = false;
    renderSend();
  }
});

refreshStatus();
setInterval(refreshStatus, STATUS_INTERVAL_MS);
