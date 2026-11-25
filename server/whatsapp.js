// WhatsApp link, as a "linked device", through the unofficial Baileys library.
import fs from 'node:fs/promises';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  buildAckStanza,
  DisconnectReason,
  fetchLatestWaWebVersion,
  generateWAMessageFromContent,
  jidNormalizedUser,
  prepareWAMessageMedia,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { registerSoundSticker } from './sound-sticker.js';

const OPUS_MIME = 'audio/ogg; codecs=opus';
const VERSION_TIMEOUT_MS = 10_000;
const MEDIA_UPLOAD_TIMEOUT_MS = 60_000;
const SEND_TIMEOUT_MS = 90_000;
const RETRY_FIRST_MS = 2_000;
const RETRY_MAX_MS = 5 * 60_000;
const RETRY_LIMIT = 8;

// Disconnect codes after which reconnecting on its own would only hammer
// WhatsApp's servers.
const STOP_CODES = {
  [DisconnectReason.loggedOut]: { clearSession: true, note: 'A conexão foi encerrada pelo celular. Conecte de novo.' },
  [DisconnectReason.badSession]: { clearSession: true, note: 'A conexão salva ficou inválida. Conecte de novo.' },
  [DisconnectReason.multideviceMismatch]: { clearSession: true, note: 'A conexão salva ficou inválida. Conecte de novo.' },
  [DisconnectReason.forbidden]: { clearSession: false, note: 'O WhatsApp recusou a conexão desta conta.' },
  [DisconnectReason.connectionReplaced]: {
    clearSession: false,
    note: 'Esta conta foi aberta no Figuráudio em outro lugar. Feche o outro e clique em Conectar.',
  },
};

class WhatsAppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createWhatsApp({ dataDir }) {
  const sessionDir = path.join(dataDir, 'session');
  // Only warnings and errors, without message details, host name or process
  // id: Baileys logs contacts' numbers and names, and this file stays on disk.
  const logger = pino(
    {
      level: 'warn',
      base: null,
      redact: {
        paths: [
          'key', 'msgAttrs', 'node', 'attrs', 'recv', 'sent', 'jid', 'addr', 'participant', 'participantAlt',
          'sender', 'author', 'from', 'remoteJid', 'histNotification', 'deviceJids', 'fullErrorNode',
          'err.data', 'error.data', '*.jid', '*.attrs', '*.key', '*.participant', '*.remoteJid',
        ],
        remove: true,
      },
    },
    pino.destination({ dest: path.join(dataDir, 'whatsapp.log'), sync: false, mode: 0o600 }),
  );

  let sock = null;
  let wanted = false;
  let generation = 0;
  let retryTimer = null;
  let retries = 0;
  let status = { state: 'off', qr: null, me: null, note: null };

  function setStatus(next) {
    status = { qr: null, me: null, note: null, ...next };
  }

  // True only after a QR code was scanned; an unfinished attempt leaves
  // credentials without an account.
  async function hasSession() {
    try {
      const creds = JSON.parse(await fs.readFile(path.join(sessionDir, 'creds.json'), 'utf8'));
      return Boolean(creds.me?.id);
    } catch {
      return false;
    }
  }

  async function clearSession() {
    await fs.rm(sessionDir, { recursive: true, force: true, maxRetries: 3 }).catch((error) => {
      logger.warn({ err: error }, 'could not delete the session folder');
    });
  }

  // Detaches whatever socket or pending start exists, so only one connection
  // ever writes the session files. Returns the detached socket, still open.
  function detachCurrent() {
    generation += 1;
    clearTimeout(retryTimer);
    retryTimer = null;
    const current = sock;
    sock = null;
    return current;
  }

  function stopCurrent() {
    detachCurrent()?.end(undefined);
  }

  function scheduleRetry(immediate) {
    if (!wanted) return;
    if (!immediate && retries >= RETRY_LIMIT) {
      wanted = false;
      setStatus({ state: 'off', note: 'Não consegui reconectar ao WhatsApp. Confira a internet e clique em Conectar.' });
      return;
    }
    const delay = immediate ? 500 : Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** retries);
    if (!immediate) retries += 1;
    setStatus({ state: 'connecting' });
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (wanted && !sock) start().catch(fail);
    }, delay);
  }

  async function onConnectionUpdate(current, { connection, lastDisconnect, qr }) {
    if (sock !== current) return;
    if (qr) setStatus({ state: 'qr', qr: await QRCode.toDataURL(qr, { margin: 4, width: 360 }) });

    const code = lastDisconnect?.error?.output?.statusCode;
    if (connection) logger.warn({ event: 'connection', connection, code }, 'connection update');
    if (connection === 'open') {
      retries = 0;
      setStatus({ state: 'open', me: jidNormalizedUser(current.user?.id || '').split('@')[0] });
    }
    if (connection !== 'close') return;

    sock = null;
    const stop = STOP_CODES[code];
    if (stop) {
      wanted = false;
      if (stop.clearSession) await clearSession();
      setStatus({ state: 'off', note: stop.note });
    } else if (code === DisconnectReason.timedOut && status.state === 'qr') {
      wanted = false;
      setStatus({ state: 'off', note: 'O QR Code expirou. Clique em Gerar novo QR Code.' });
    } else if (wanted) {
      // 515 comes right after the QR code is scanned: reconnect at once.
      scheduleRetry(code === DisconnectReason.restartRequired);
    } else {
      setStatus({ state: 'off' });
    }
  }

  async function start() {
    const myGeneration = generation;
    await fs.mkdir(sessionDir, { recursive: true, mode: 0o700 });
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    // The phone refuses to link a client that reports an old WhatsApp Web
    // version, and the one bundled with Baileys goes stale. Ask WhatsApp Web
    // for the current one; on failure Baileys returns its bundled version.
    const { version, isLatest } = await fetchLatestWaWebVersion({ signal: AbortSignal.timeout(VERSION_TIMEOUT_MS) });
    if (!isLatest) logger.warn({ version }, 'could not fetch the current WhatsApp Web version');
    // Logged out, restarted or superseded while waiting above.
    if (myGeneration !== generation || !wanted) return;

    const current = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.windows('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // The app only sends; it never needs the chat history.
      shouldSyncHistoryMessage: () => false,
    });
    sock = current;

    // Baileys acknowledges server notifications with the account id, which
    // does not exist until the QR code is scanned: it throws and the
    // notification is never acknowledged, and the phone then fails to link
    // ("sem conexão"). Acknowledge those ourselves until the account exists.
    current.ws.on('CB:notification', (node) => {
      if (state.creds.me?.id) return;
      logger.warn({ event: 'ack-before-login', type: node.attrs.type }, 'acknowledging a notification received before login');
      current.sendNode(buildAckStanza(node)).catch((error) => logger.warn({ err: error }, 'ack before login failed'));
    });

    // Baileys ignores the promises these listeners return: catch everything,
    // or one failure would end the whole program.
    current.ev.on('creds.update', () => {
      if (sock !== current) return;
      saveCreds().catch((error) => logger.error({ err: error }, 'could not save the session'));
    });
    current.ev.on('connection.update', (update) => {
      onConnectionUpdate(current, update).catch((error) => logger.error({ err: error }, 'connection update failed'));
    });
  }

  function fail(error) {
    logger.error({ err: error }, 'whatsapp start failed');
    sock = null;
    wanted = false;
    setStatus({ state: 'off', note: 'Não consegui conectar ao WhatsApp. Confira a internet.' });
  }

  return {
    getStatus: () => status,

    async connect() {
      if (wanted) return;
      wanted = true;
      retries = 0;
      stopCurrent();
      setStatus({ state: 'connecting' });
      start().catch(fail);
    },

    async resume() {
      if (await hasSession()) await this.connect();
    },

    // Drops the current linking attempt and starts over with a new QR code.
    // A linked account is left alone.
    async newQr() {
      if (status.state === 'open') return;
      stopCurrent();
      wanted = true;
      retries = 0;
      if (!(await hasSession())) await clearSession();
      setStatus({ state: 'connecting' });
      start().catch(fail);
    },

    async logout() {
      wanted = false;
      // Log out on the open socket first, so the phone drops this device too.
      const current = detachCurrent();
      if (current) {
        try {
          await current.logout();
        } catch {
          current.end(undefined);
        }
      }
      await clearSession();
      setStatus({ state: 'off' });
    },

    // Sends to the user's own "message yourself" chat, and nowhere else.
    async sendSoundSticker({ sticker, audio, seconds }) {
      if (!sock || status.state !== 'open') throw new WhatsAppError(409, 'Conecte o WhatsApp antes de enviar.');
      const current = sock;
      const send = async () => {
        const upload = { upload: current.waUploadToServer, logger, mediaUploadTimeoutMs: MEDIA_UPLOAD_TIMEOUT_MS };
        const { stickerMessage } = await prepareWAMessageMedia({ sticker }, upload);
        const { audioMessage } = await prepareWAMessageMedia(
          { audio, mimetype: OPUS_MIME, seconds, ptt: false },
          upload,
        );

        Object.assign(stickerMessage, {
          width: 512,
          height: 512,
          // Sound stickers are sent flagged as animated, including still images.
          isAnimated: true,
          stickerSentTs: Date.now(),
          isAvatar: false,
          isAiSticker: false,
          isLottie: false,
        });
        Object.assign(audioMessage, { mimetype: OPUS_MIME, seconds, ptt: false });
        registerSoundSticker(stickerMessage, audioMessage);

        const myJid = jidNormalizedUser(current.user.id);
        const message = generateWAMessageFromContent(myJid, { stickerMessage }, { userJid: myJid });
        await current.relayMessage(myJid, message.message, { messageId: message.key.id });
        return { id: message.key.id };
      };

      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new WhatsAppError(504, 'O envio demorou demais. Confira a internet e tente de novo.')),
          SEND_TIMEOUT_MS,
        );
      });
      try {
        return await Promise.race([send(), timeout]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
