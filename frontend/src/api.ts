// Empty in dev and Docker (requests go through the Vite/nginx proxy); set VITE_BACKEND_URL to call the backend directly
export const API_BASE = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

/** Synthesizer tuning, kept in this browser and sent with every voice generation */
export interface SynthSettings {
  /** 1 is the model default, higher is faster */
  speed: number;
  /** How much pitch and tone vary; lower is steadier */
  expressiveness: number;
  /** How much rhythm and pauses vary */
  variation: number;
  language: string;
}

// Nominal defaults of the YourTTS model. Only values the user moved away from these are sent,
// so an untouched slider always means "whatever the model does by default".
export const DEFAULT_SYNTH: SynthSettings = { speed: 1, expressiveness: 0.667, variation: 1, language: 'en' };

export const LANGUAGES: Array<[string, string]> = [
  ['en', 'English'],
  ['fr-fr', 'French'],
  ['pt-br', 'Portuguese (Brazil)']
];

const SYNTH_KEY = 'echo.synth';
const AVATAR_KEY = 'echo.avatar';

export function loadSynth(): SynthSettings {
  try {
    return { ...DEFAULT_SYNTH, ...(JSON.parse(localStorage.getItem(SYNTH_KEY) || '{}') || {}) };
  } catch {
    return DEFAULT_SYNTH;
  }
}

export function saveSynth(settings: SynthSettings) {
  try {
    localStorage.setItem(SYNTH_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings just won't survive a reload */
  }
}

export const synthIsDefault = (s: SynthSettings) =>
  s.speed === DEFAULT_SYNTH.speed && s.expressiveness === DEFAULT_SYNTH.expressiveness && s.variation === DEFAULT_SYNTH.variation && s.language === DEFAULT_SYNTH.language;

export function loadAvatarGender(): 'F' | 'M' {
  try {
    return localStorage.getItem(AVATAR_KEY) === 'M' ? 'M' : 'F';
  } catch {
    return 'F';
  }
}

export function saveAvatarGender(gender: 'F' | 'M') {
  try {
    localStorage.setItem(AVATAR_KEY, gender);
  } catch {
    /* ignore */
  }
}
