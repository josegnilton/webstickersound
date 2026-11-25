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
const QR_TIMED_OUT = 408;

export function createWhatsApp({ dataDir }) {
  const sessionDir = path.join(dataDir, 'session');
  // Only warnings and errors, with message details removed: Baileys logs
  // contacts' numbers and names at lower levels, and this file stays on disk.
  const logger = pino(
    {
      level: 'warn',
      redact: {
        paths: ['key', 'msgAttrs', 'node', 'attrs', 'recv', 'sent', 'jid', 'addr', 'participant', 'histNotification', 'deviceJids'],
        remove: true,
      },
    },
    pino.destination({ dest: path.join(dataDir, 'whatsapp.log'), sync: false }),
  );

  let sock = null;
  let wanted = false;
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

  async function start() {
    await fs.mkdir(sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    // The phone refuses to link a client that reports an old WhatsApp Web
    // version, and the one bundled with Baileys goes stale. Ask WhatsApp Web
    // for the current one; on failure Baileys returns its bundled version.
    const { version, isLatest } = await fetchLatestWaWebVersion({});
    if (!isLatest) logger.warn({ version }, 'could not fetch the current WhatsApp Web version');
    const current = makeWASocket({
      version,
      auth: state,
      logger,
      browser: Browsers.windows('Chrome'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
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

    current.ev.on('creds.update', saveCreds);
    current.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (sock !== current) return;

      if (qr) {
        setStatus({ state: 'qr', qr: await QRCode.toDataURL(qr, { margin: 4, width: 360 }) });
      }
      if (connection) logger.warn({ event: 'connection', connection, code: lastDisconnect?.error?.output?.statusCode }, 'connection update');
      if (connection === 'open') {
        setStatus({ state: 'open', me: jidNormalizedUser(current.user.id).split('@')[0] });
      }
      if (connection === 'close') {
        sock = null;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          wanted = false;
          await fs.rm(sessionDir, { recursive: true, force: true });
          setStatus({ state: 'off', note: 'Sessão encerrada. Conecte de novo.' });
        } else if (code === QR_TIMED_OUT && status.state === 'qr') {
          wanted = false;
          setStatus({ state: 'off', note: 'O QR Code expirou. Clique em Conectar de novo.' });
        } else if (wanted) {
          setStatus({ state: 'connecting' });
          setTimeout(() => wanted && !sock && start().catch(fail), 2000);
        } else {
          setStatus({ state: 'off' });
        }
      }
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
      wanted = true;
      const current = sock;
      sock = null;
      current?.end(undefined);
      if (!(await hasSession())) await fs.rm(sessionDir, { recursive: true, force: true });
      setStatus({ state: 'connecting' });
      start().catch(fail);
    },

    async logout() {
      wanted = false;
      const current = sock;
      sock = null;
      if (current) {
        try {
          await current.logout();
        } catch {
          current.end(undefined);
        }
      }
      await fs.rm(sessionDir, { recursive: true, force: true });
      setStatus({ state: 'off' });
    },

    // Sends to the user's own "message yourself" chat.
    async sendSoundSticker({ sticker, audio, seconds }) {
      if (!sock || status.state !== 'open') throw new Error('WhatsApp não está conectado.');
      const current = sock;
      const upload = { upload: current.waUploadToServer, logger };

      const { stickerMessage } = await prepareWAMessageMedia({ sticker }, upload);
      const { audioMessage } = await prepareWAMessageMedia(
        { audio, mimetype: OPUS_MIME, seconds, ptt: false },
        upload,
      );

      const sentTs = Date.now();
      Object.assign(stickerMessage, {
        width: 512,
        height: 512,
        // Sound stickers are sent flagged as animated, including still images.
        isAnimated: true,
        stickerSentTs: sentTs,
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
    },
  };
}
