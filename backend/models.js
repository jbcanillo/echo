// What each supported voice model can do. The model is chosen with TTS_MODEL_NAME; everything the app shows
// (the language list, which tuning sliders apply and their defaults) comes from the matching profile here.
//
// To add another model: add a profile, then teach voice_clone.py how to load it and apply its tuning.

const LANGUAGE_NAMES = {
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  'fr-fr': 'French',
  de: 'German',
  it: 'Italian',
  pt: 'Portuguese',
  'pt-br': 'Portuguese (Brazil)',
  pl: 'Polish',
  tr: 'Turkish',
  ru: 'Russian',
  nl: 'Dutch',
  cs: 'Czech',
  ar: 'Arabic',
  'zh-cn': 'Chinese',
  hu: 'Hungarian',
  ko: 'Korean',
  ja: 'Japanese',
  hi: 'Hindi'
};

const PROFILES = [
  {
    id: 'yourtts',
    name: 'YourTTS',
    match: /your_?tts/i,
    languages: ['en', 'fr-fr', 'pt-br'],
    // speed -> length scale, expressiveness -> noise scale, variation -> duration noise scale (all VITS settings)
    tuning: { speed: true, expressiveness: true, variation: true },
    defaults: { speed: 1, expressiveness: 0.667, variation: 1 },
    license: 'CC BY-NC-ND 4.0 (non-commercial)'
  },
  {
    id: 'xtts',
    name: 'XTTS-v2',
    match: /xtts/i,
    // The language codes XTTS-v2 itself accepts
    languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'pl', 'tr', 'ru', 'nl', 'cs', 'ar', 'zh-cn', 'hu', 'ko', 'ja', 'hi'],
    // speed -> speed, expressiveness -> temperature. XTTS has no equivalent of rhythm variation.
    tuning: { speed: true, expressiveness: true, variation: false },
    defaults: { speed: 1, expressiveness: 0.85, variation: 1 },
    license: 'Coqui Public Model License (non-commercial)',
    // The first download asks the user to accept this license; the worker needs COQUI_TOS_AGREED=1 to proceed
    requiresLicenseAcceptance: true
  }
];

// Any other model: assume nothing beyond English and let the worker ignore settings the model does not have
const GENERIC = {
  id: 'generic',
  name: null,
  languages: ['en'],
  tuning: { speed: true, expressiveness: true, variation: true },
  defaults: { speed: 1, expressiveness: 0.667, variation: 1 },
  license: null
};

function profileFor(modelName) {
  return PROFILES.find((p) => p.match.test(modelName || '')) || { ...GENERIC, name: modelName };
}

/** What the browser needs to know about the active model */
function describe(modelName) {
  const p = profileFor(modelName);
  return {
    id: p.id,
    name: p.name,
    model: modelName,
    languages: p.languages.map((code) => ({ code, name: LANGUAGE_NAMES[code] || code })),
    tuning: p.tuning,
    defaults: p.defaults,
    license: p.license,
    requiresLicenseAcceptance: Boolean(p.requiresLicenseAcceptance)
  };
}

module.exports = { profileFor, describe };
