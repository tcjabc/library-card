// Library Card's stand-in for Peek Budget's js/i18n.js, so the vendored files can import it
// unchanged. Not vendored code: it maps the Peek message keys the vendored files use to texts in
// src/strings/en.ts (mostly its `sync` section), picks the plural form for a numeric {count} the way
// Peek's t() does (key.one / key.other), and fills in {placeholders} (an unknown placeholder stays
// as it is). An unknown key gives '' and one warning, as in Peek.

import { fmt, strings } from '../../strings';

/** Keys whose Library Card path differs from the Peek key (words.js and crypto.js). */
const RENAMED = {
  'sync.key.format': 'sync.keyFormat',
  'sync.key.invalid': 'sync.keyInvalid',
  'sync.words.error.empty': 'sync.wordsEmpty',
  'sync.words.error.unknown': 'sync.wordsUnknown',
  'sync.words.error.unknownNear': 'sync.wordsUnknownNear',
  'sync.words.error.count': 'sync.wordsCount',
  'sync.words.error.checksum': 'sync.wordsChecksum',
};

/** Keys at the same path in `strings` as in Peek (sync.js, secure-key.js, pairing.js, qr-scan.js). */
const SAME = [
  'common.cancel',
  'sync.needsWords', 'sync.keyUnavailable', 'sync.offline', 'sync.clockAhead', 'sync.deleted',
  'sync.error.401', 'sync.error.410', 'sync.error.413', 'sync.error.429', 'sync.error.507', 'sync.error.5xx',
  'sync.error.refused', 'sync.error.relayAnswered', 'sync.error.unreachable', 'sync.error.failed',
  'sync.error.order', 'sync.error.stopped', 'sync.error.relayAddress', 'sync.error.keyInUse', 'sync.error.notOn',
  'sync.join.noHousehold', 'sync.join.offline', 'sync.join.deleted',
  'sync.replace.title', 'sync.replace.message', 'sync.replace.confirm',
  'sync.startNew.title', 'sync.startNew.message', 'sync.startNew.confirm',
  'sync.turnOff.title', 'sync.turnOff.message', 'sync.turnOff.confirm',
  'sync.showWords.title', 'sync.showWords.message', 'sync.showWords.confirm',
  'sync.state.off', 'sync.state.syncing', 'sync.state.ok', 'sync.state.offline', 'sync.state.error', 'sync.state.deleted',
  'sync.status.withError', 'sync.status.withNote',
  'sync.summary.needsWords', 'sync.summary.off', 'sync.summary.paused', 'sync.summary.on',
  'sync.scan.notRecovery',
];

/** Peek Budget message key -> dotted path in `strings`. */
export const KEYS = Object.freeze({ ...RENAMED, ...Object.fromEntries(SAME.map((k) => [k, k])) });

const plural = new Intl.PluralRules('en');
const warned = new Set();

function lookup(path) {
  let v = strings;
  for (const part of path.split('.')) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, part)) return undefined;
    v = v[part];
  }
  return v;
}

/** The text for `key`, with {placeholders} from `params`. */
export function t(key, params) {
  let template = Object.hasOwn(KEYS, key) ? lookup(KEYS[key]) : undefined;
  if (template !== null && typeof template === 'object') {
    const n = Number(params?.count);
    template = template[Number.isFinite(n) ? plural.select(n) : 'other'] ?? template.other;
  }
  if (typeof template !== 'string') {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`i18n: "${key}" has no Library Card text.`);
    }
    return '';
  }
  return params ? fmt(template, params) : template;
}
