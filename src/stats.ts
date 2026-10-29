/**
 * Anonymous usage statistics via GoatCounter (https://www.goatcounter.com): no cookies, no
 * personal data. Only active on the live site and only when a site code is configured.
 */

import { IS_TEST } from './env';

/** GoatCounter site code: https://<code>.goatcounter.com. Empty = statistics off. */
const GOATCOUNTER_CODE: string = 'rednoos';

interface GoatCounter {
  count(vars: { path: string; title?: string; event?: boolean }): void;
}
declare global {
  interface Window {
    goatcounter?: GoatCounter & { no_onload?: boolean };
  }
}

const enabled = import.meta.env.PROD && !IS_TEST && GOATCOUNTER_CODE !== '';
/** Events sent before the script has loaded. */
const queue: { path: string; title?: string }[] = [];

export function initStats() {
  if (!enabled) return;
  // Tell visitors (start screen) only when statistics are actually on; that line also covers
  // the feedback note, so the feedback-only line goes.
  const note = document.getElementById('privacy');
  if (note) note.hidden = false;
  const feedbackNote = document.getElementById('feedback-privacy');
  if (feedbackNote) feedbackNote.hidden = true;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://gc.zgo.at/count.js';
  script.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  script.onload = () => {
    for (const e of queue.splice(0)) window.goatcounter?.count({ ...e, event: true });
  };
  document.head.append(script);
}

/** Counts an event, e.g. "start/netherlands+physical". Shown under "events" in GoatCounter. */
export function track(path: string, title?: string) {
  if (!enabled) return;
  if (window.goatcounter?.count) window.goatcounter.count({ path, title, event: true });
  else queue.push({ path, title });
}

/** Score bucket for finished games: exact scores aren't needed to judge the difficulty. */
export function scoreBucket(n: number): string {
  if (n < 5) return '0-4';
  if (n < 10) return '5-9';
  if (n < 20) return '10-19';
  if (n < 30) return '20-29';
  if (n < 50) return '30-49';
  return '50+';
}
