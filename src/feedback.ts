import type { Lang } from './i18n';

/** Tally feedback forms (tally.so, EU), one per language; responses are mailed to the maker. */
const FORMS: Record<Lang, string> = {
  nl: '2jEa2V',
  en: 'kbdeVJ',
  de: '4aaK7Y',
  'sr-Latn': '1WAdZO',
  'sr-Cyrl': 'xVXDx9',
};

/** Filled in by the game, hidden in the form: what the feedback is about. */
export interface FeedbackContext {
  /** `map-request` makes the form skip straight to its "request a map" page. */
  type: 'feedback' | 'map-request';
  map: string;
  mode: string;
  lang: Lang;
}

interface TallyApi {
  openPopup(formId: string, options: { layout?: 'modal'; width?: number; autoClose?: number; hiddenFields?: Record<string, string> }): void;
}

let tally: Promise<TallyApi | undefined> | undefined;

/** Tally's popup script, loaded on the first click only (nothing from Tally on page load). */
function loadTally(): Promise<TallyApi | undefined> {
  tally ??= new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://tally.so/widgets/embed.js';
    script.onload = () => resolve((window as unknown as { Tally?: TallyApi }).Tally);
    script.onerror = () => resolve(undefined);
    document.head.append(script);
  });
  return tally;
}

export async function openFeedback(context: FeedbackContext) {
  const id = FORMS[context.lang] ?? FORMS.en;
  const hiddenFields = {
    type: context.type,
    map: context.map,
    mode: context.mode,
    lang: context.lang,
    device: matchMedia('(pointer: coarse)').matches ? 'telefoon' : 'computer',
    // Where the player roughly is, without asking: browser language (e.g. nl-BE) and time zone.
    locale: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
  };
  const api = await loadTally();
  if (api) {
    api.openPopup(id, { layout: 'modal', width: 520, autoClose: 4000, hiddenFields });
  } else {
    // Script blocked (e.g. by an ad blocker): the form in a new tab, or here if that is blocked too.
    const url = `https://tally.so/r/${id}?${new URLSearchParams(hiddenFields)}`;
    const tab = window.open(url, '_blank');
    if (tab) tab.opener = null;
    else location.assign(url);
  }
}
