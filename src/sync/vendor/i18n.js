// Library Card's stand-in for Peek Budget's js/i18n.js, so the vendored files can import it
// unchanged. Not vendored code: it only maps the message keys words.js and crypto.js use to the
// `sync` section of src/strings/en.ts, and fills in {placeholders} the way Peek's t() does
// (an unknown placeholder stays as it is). An unknown key gives '' and one warning, as in Peek.

import { fmt, strings } from '../../strings';

/** Peek Budget message key -> name in strings.sync. */
export const KEYS = Object.freeze({
  'sync.key.format': 'keyFormat',
  'sync.key.invalid': 'keyInvalid',
  'sync.words.error.empty': 'wordsEmpty',
  'sync.words.error.unknown': 'wordsUnknown',
  'sync.words.error.unknownNear': 'wordsUnknownNear',
  'sync.words.error.count': 'wordsCount',
  'sync.words.error.checksum': 'wordsChecksum',
});

const warned = new Set();

/** The text for `key`, with {placeholders} from `params`. */
export function t(key, params) {
  const name = Object.hasOwn(KEYS, key) ? KEYS[key] : undefined;
  const template = name === undefined ? undefined : strings.sync[name];
  if (template === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn(`i18n: "${key}" has no Library Card text.`);
    }
    return '';
  }
  return params ? fmt(template, params) : template;
}
