// Empty in dev and Docker (requests go through the Vite/nginx proxy); set VITE_BACKEND_URL to call the backend directly
export const API_BASE = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');

/** Limits the server enforces; the UI asks the server for them instead of hard-coding its own */
export interface Limits {
  maxTextLength: number;
  maxPromptLength: number;
  maxUploadMb: number;
}

// Used until the server answers (and if it can't be reached): the server's own defaults
export const DEFAULT_LIMITS: Limits = { maxTextLength: 5000, maxPromptLength: 1000, maxUploadMb: 20 };

/** What the server's voice model can do. It is chosen with TTS_MODEL_NAME on the server. */
export interface ModelInfo {
  id: string;
  /** Short name such as "XTTS-v2", or null for a model Echo doesn't know */
  name: string | null;
  model: string;
  languages: Array<{ code: string; name: string }>;
  /** Which tuning sliders the model understands */
  tuning: { speed: boolean; expressiveness: boolean; variation: boolean };
  /** The model's own starting values: a slider left on these sends nothing */
  defaults: { speed: number; expressiveness: number; variation: number };
  license: string | null;
  requiresLicenseAcceptance: boolean;
}

// Used until the server answers (and if it can't be reached): YourTTS, the default model
export const DEFAULT_MODEL: ModelInfo = {
  id: 'yourtts',
  name: 'YourTTS',
  model: '',
  languages: [
    { code: 'en', name: 'English' },
    { code: 'fr-fr', name: 'French' },
    { code: 'pt-br', name: 'Portuguese (Brazil)' }
  ],
  tuning: { speed: true, expressiveness: true, variation: true },
  defaults: { speed: 1, expressiveness: 0.667, variation: 1 },
  license: null,
  requiresLicenseAcceptance: false
};

export interface ServerConfig {
  limits: Limits;
  model: ModelInfo;
}

export async function fetchConfig(): Promise<ServerConfig | null> {
  try {
    const response = await fetch(`${API_BASE}/api/config`);
    if (!response.ok) return null;
    const data = await response.json();
    const synthesizer = data.synthesizer;
    return {
      limits: {
        maxTextLength: Number(data.maxTextLength) || DEFAULT_LIMITS.maxTextLength,
        maxPromptLength: Number(data.maxPromptLength) || DEFAULT_LIMITS.maxPromptLength,
        maxUploadMb: Number(data.maxUploadMb) || DEFAULT_LIMITS.maxUploadMb
      },
      // An older server doesn't describe its model: assume the default one
      model: synthesizer && Array.isArray(synthesizer.languages) && synthesizer.languages.length ? { ...DEFAULT_MODEL, ...synthesizer } : DEFAULT_MODEL
    };
  } catch {
    return null;
  }
}

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

/** A model's own starting values. Only values the user moved away from these are sent, so an untouched
 *  slider always means "whatever the model does by default". */
export const defaultSynth = (model: ModelInfo): SynthSettings => ({ ...model.defaults, language: 'en' });

const SYNTH_KEY = 'echo.synth';
const AVATAR_KEY = 'echo.avatar';

export function loadSynth(): SynthSettings {
  try {
    return { ...defaultSynth(DEFAULT_MODEL), ...(JSON.parse(localStorage.getItem(SYNTH_KEY) || '{}') || {}) };
  } catch {
    return defaultSynth(DEFAULT_MODEL);
  }
}

// Saved settings belong to the model they were set for. Before this was tracked, YourTTS was the only model.
const SYNTH_MODEL_KEY = 'echo.synth.model';

export function loadSynthModel(): string {
  try {
    return localStorage.getItem(SYNTH_MODEL_KEY) || 'yourtts';
  } catch {
    return 'yourtts';
  }
}

export function saveSynthModel(id: string) {
  try {
    localStorage.setItem(SYNTH_MODEL_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Fit saved settings to the server's model: another model starts from its own defaults, and a language
 *  the model doesn't have falls back to English */
export function reconcileSynth(current: SynthSettings, model: ModelInfo, savedModel: string): SynthSettings {
  const base = savedModel === model.id ? current : { ...defaultSynth(model), language: current.language };
  return { ...base, language: model.languages.some((l) => l.code === base.language) ? base.language : 'en' };
}

export function saveSynth(settings: SynthSettings) {
  try {
    localStorage.setItem(SYNTH_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings just won't survive a reload */
  }
}

export const synthIsDefault = (s: SynthSettings, model: ModelInfo) =>
  s.speed === model.defaults.speed && s.expressiveness === model.defaults.expressiveness && s.variation === model.defaults.variation && s.language === 'en';


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
