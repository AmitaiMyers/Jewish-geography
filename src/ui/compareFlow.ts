import qrcode from 'qrcode-generator';
import { findOverlap } from '../compare/overlap';
import { buildPayload, decodePayload, encodePayload, PAYLOAD_PREFIX, type ComparePayload } from '../compare/payload';
import { relationTypeName, t, tCount } from '../i18n/i18n';
import { SOCIAL_TYPES, type RelationType } from '../model/types';
import { avatar } from './avatar';
import { JgSheet } from './components/sheet';
import { groupColors, type AppContext } from './context';
import { bdi, chooseTextFile, h, replaceChildren, toast } from './dom';
import { icon } from './icons';
import { haptic, shake } from './motion';

/**
 * Stage 2 — compare graphs with a friend, no server involved:
 *   show my code (QR / share)  →  friend scans it  →  friend reviews who we both know.
 * Each side does the same, so both graphs end up linked.
 */

const SCAN_INTERVAL_MS = 200;
const MAX_SCAN_WIDTH = 800;
const FRIEND_TYPES: readonly RelationType[] = [...SOCIAL_TYPES, 'sibling', 'spouse'];

export function openMyCode(ctx: AppContext): void {
  const store = ctx.store;
  const me = store.person(store.meId);
  const code = encodePayload(buildPayload(me, [...store.people.values()]));
  const qr = qrcode(0, 'L');
  qr.addData(code);
  qr.make();

  const qrCard = h('div', { class: 'qr-card', role: 'img', 'aria-label': t('myCodeTitle'), 'data-code': code });
  qrCard.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });

  const sheet = JgSheet.create({ snaps: ['full'], disposable: true });
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
          if (result !== null && result.data.startsWith(PAYLOAD_PREFIX)) {
            void finish(result.data);
            return;
          }
        }
        frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    }, cameraUnavailable);
}

/** Shows who we both know; nothing is written until the user confirms. */
export function openOverlapReview(ctx: AppContext, payload: ComparePayload): void {
  const store = ctx.store;
  const overlap = findOverlap(payload, [...store.people.values()], store.meId);
  const chosen = new Set(overlap.commonIds);
  const friendName = overlap.friendId === null ? payload.name : store.person(overlap.friendId).name;
  const sheet = JgSheet.create({ snaps: ['full'], disposable: true });

  const relationSelect = h(
    'select',
    { 'aria-label': t('connectionType') },
    ...FRIEND_TYPES.map((type) => h('option', { value: type, selected: type === 'friend' }, relationTypeName(type))),
  );
  const confirm = h('button', { class: 'btn btn-primary' }, t('confirmAdd'));
  confirm.addEventListener('click', async () => {
    confirm.classList.add('is-loading');
    const friendId = await store.applyComparison({
      friendId: overlap.friendId,
      newFriend: { name: payload.name, phones: payload.phones, emails: payload.emails },
      relationType: relationSelect.value as RelationType,
      label: '',
      commonIds: [...chosen],
    });
    await sheet.close();
    haptic([10, 40, 10]);
    toast(tCount('compareDone', chosen.size, { name: friendName }), { success: true });
    ctx.showOnGraph({ kind: 'person', personId: friendId });
  });

  const list = h('ul', { class: 'list' });
  replaceChildren(
    list,
    ...overlap.commonIds.map((id) => {
      const person = store.person(id);
      const checkbox = h('input', { type: 'checkbox', checked: true, 'aria-label': person.name });
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) chosen.add(id);
        else chosen.delete(id);
      });
      return h(
        'li',
        {},
        h(
          'label',
          { class: 'list-row' },
          checkbox,
          avatar(person.name, groupColors(store, person), 'sm'),
          h('span', { class: 'grow ellipsis' }, bdi(person.name)),
        ),
      );
    }),
  );

  sheet.setTitle(t('overlapTitle', { name: friendName, count: overlap.commonIds.length }));
  sheet.setBody(
    h(
      'div',
      { class: 'stack-lg' },
      h(
        'div',
        { class: 'card stack' },
        h(
          'div',
          { class: 'row' },
          avatar(friendName, [], 'lg'),
          h(
            'div',
            { class: 'grow' },
            h('p', { class: 'big-answer' }, bdi(friendName)),
            h('p', { class: 'caption' }, overlap.friendId === null ? t('friendNew', { name: friendName }) : t('friendKnown', { name: friendName })),
          ),
        ),
        h('label', { class: 'field' }, h('span', { class: 'label' }, t('friendIs', { name: friendName })), relationSelect),
      ),
      overlap.commonIds.length === 0
        ? h('p', { class: 'muted' }, t('overlapNone', { name: friendName }))
        : h('div', { class: 'stack' }, h('p', { class: 'caption' }, t('overlapHint')), list),
    ),
  );
  sheet.setFooter(h('button', { class: 'btn', onclick: () => void sheet.close() }, t('cancel')), confirm);
  sheet.open();
}
