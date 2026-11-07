import qrcode from 'qrcode-generator';
import { findOverlap } from '../compare/overlap';
import { buildPayload, decodePayload, encodePayload, PAYLOAD_PREFIX, type ComparePayload } from '../compare/payload';
import { FrameCollector, isCompareQr, toFrames } from '../compare/qrFrames';
import { t } from '../i18n/i18n';
import { JgSheet } from './components/sheet';
import type { AppContext } from './context';
import { chooseTextFile, h, toast } from './dom';
import { icon } from './icons';
import { haptic, shake } from './motion';
import { openPitzuchim } from './pitzuchim';

/**
 * Stage 2 — compare graphs with a friend, no server involved:
 *   show my code (QR / share)  →  friend scans it  →  the Pitzuchim reveal shows who we both know.
 * Each side does the same, so both graphs end up linked.
 */

const SCAN_INTERVAL_MS = 200;
const MAX_SCAN_WIDTH = 800;
const FRAME_INTERVAL_MS = 450;

export function openMyCode(ctx: AppContext): void {
  const store = ctx.store;
  const me = store.person(store.meId);
  const code = encodePayload(buildPayload(me, [...store.people.values()]));
  // Large codes are shown as a short loop of QR frames; the scanner collects them in any order.
  const frames = toFrames(code).map((frameText) => {
    const qr = qrcode(0, 'L');
    qr.addData(frameText);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  });
  const qrCard = h('div', { class: 'qr-card', role: 'img', 'aria-label': t('myCodeTitle'), 'data-code': code, 'data-frames': frames.length });
  const dots = h('div', { class: 'qr-dots', 'aria-hidden': 'true' }, ...frames.map(() => h('span', {})));
  let shown = 0;
  const showFrame = (index: number): void => {
    qrCard.innerHTML = frames[index] as string;
    dots.querySelectorAll('span').forEach((dot, i) => dot.classList.toggle('is-on', i === index));
  };
  showFrame(0);
  const cycle = frames.length > 1 ? window.setInterval(() => showFrame((shown = (shown + 1) % frames.length)), FRAME_INTERVAL_MS) : undefined;

  const sheet = JgSheet.create({ snaps: ['full'], disposable: true });
  sheet.onClose(() => window.clearInterval(cycle));
  sheet.setTitle(t('myCodeTitle'));
  sheet.setBody(
    h(
      'div',
      { class: 'stack-lg' },
      me.phones.length + me.emails.length === 0
        ? h(
            'div',
            { class: 'card row' },
            h('span', { class: 'grow' }, t('addPhoneForCompare')),
            h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  await sheet.close();
                  ctx.openPerson(me.id, 'full');
                },
              },
              t('addPhone'),
            ),
          )
        : null,
      qrCard,
      frames.length > 1 ? dots : null,
      h('p', {}, t('myCodeHint')),
      h('p', { class: 'caption' }, t('myCodePrivacy')),
      h(
        'button',
        {
          class: 'btn btn-block',
          onclick: async () => {
            if (typeof navigator.share === 'function') {
              // Closing the share sheet rejects with AbortError: that is the user's choice, not a failure.
              await navigator.share({ title: t('appName'), text: code }).catch((error: unknown) => {
                if (!(error instanceof DOMException && error.name === 'AbortError')) throw error;
              });
            } else {
              await navigator.clipboard.writeText(code);
              toast(t('copied'), { success: true });
            }
          },
        },
        icon('share'),
        t('shareCode'),
      ),
    ),
  );
  sheet.setFooter(
    h(
      'button',
      {
        class: 'btn btn-primary',
        onclick: async () => {
          await sheet.close();
          openScanner(ctx);
        },
      },
      icon('camera'),
      t('nowScanTheirs'),
    ),
  );
  sheet.open();
}

export function openScanner(ctx: AppContext): void {
  const sheet = JgSheet.create({ snaps: ['full'], disposable: true });
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  video.setAttribute('playsinline', '');
  const scanner = h('div', { class: 'scanner' }, video);
  const status = h('p', { class: 'muted', 'aria-live': 'polite' }, t('cameraStarting'));
  const pasted = h('textarea', { rows: 3, placeholder: t('pasteCodePlaceholder'), 'aria-label': t('pasteCode'), spellcheck: false });
  const pasteError = h('p', { class: 'field-error', 'aria-live': 'polite' });
  let stream: MediaStream | null = null;
  let frame = 0;
  let finished = false;

  const stopCamera = (): void => {
    window.cancelAnimationFrame(frame);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
  };
  const finish = async (code: string): Promise<void> => {
    if (finished) return;
    finished = true;
    stopCamera();
    haptic([10, 40, 10]);
    const payload = decodePayload(code);
    await sheet.close();
    openOverlapReview(ctx, payload);
  };
  const collector = new FrameCollector();
  const submitText = (text: string): void => {
    if (!text.trim().startsWith(PAYLOAD_PREFIX)) {
      pasteError.textContent = t('notACode');
      shake(pasted);
      return;
    }
    void finish(text);
  };

  sheet.onClose(stopCamera);
  sheet.setTitle(t('scanTitle'));
  sheet.setBody(
    h(
      'div',
      { class: 'stack-lg' },
      scanner,
      status,
      h(
        'div',
        { class: 'card stack' },
        h('h3', {}, t('pasteCode')),
        pasted,
        pasteError,
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn btn-primary', onclick: () => submitText(pasted.value) }, t('compare')),
          h(
            'button',
            {
              class: 'btn',
              onclick: async () => {
                const file = await chooseTextFile('.txt,text/plain');
                if (file !== null) submitText(file.text);
              },
            },
            icon('file'),
            t('openCodeFile'),
          ),
        ),
      ),
    ),
  );
  sheet.open();

  const cameraUnavailable = (): void => {
    scanner.hidden = true;
    status.textContent = t('cameraUnavailable');
  };
  if (navigator.mediaDevices?.getUserMedia === undefined) {
    cameraUnavailable();
    return;
  }
  navigator.mediaDevices
    .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
    .then(async (mediaStream) => {
      if (!sheet.isOpen) {
        mediaStream.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = mediaStream;
      video.srcObject = mediaStream;
      status.textContent = t('cameraPointAt');
      const { default: jsQR } = await import('jsqr');
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
      let lastScan = 0;
      const tick = (now: number): void => {
        if (stream === null) return;
        if (now - lastScan >= SCAN_INTERVAL_MS && video.readyState >= video.HAVE_ENOUGH_DATA) {
          lastScan = now;
          const scale = Math.min(1, MAX_SCAN_WIDTH / video.videoWidth);
          canvas.width = Math.round(video.videoWidth * scale);
          canvas.height = Math.round(video.videoHeight * scale);
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const result = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
          if (result !== null && isCompareQr(result.data)) {
            const progress = collector.add(result.data);
            if (collector.complete !== null) {
              void finish(collector.complete);
              return;
            }
            status.textContent = t('scanProgress', { have: progress.have, need: progress.need });
          }
        }
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    }, cameraUnavailable);
}

/** Shows who we both know — the Pitzuchim reveal; nothing is written until the user confirms there. */
export function openOverlapReview(ctx: AppContext, payload: ComparePayload): void {
  const overlap = findOverlap(payload, [...ctx.store.people.values()], ctx.store.meId);
  openPitzuchim(ctx, { mode: 'compare', payload, overlap });
}
