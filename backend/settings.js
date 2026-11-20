// Runtime settings edited from the app's Settings page (currently the OpenRouter key and model).
// Stored in a JSON file next to the TTS models, so it lives in the same Docker volume and survives rebuilds.
// Values saved here take precedence over the OPENROUTER_* variables in .env.

const fs = require('fs');
const path = require('path');

const SETTINGS_FILE = process.env.SETTINGS_FILE || path.join(__dirname, 'models', 'echo-settings.json');
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

let stored = {};
try {
  stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
} catch (err) {
  if (err.code !== 'ENOENT') console.warn('Could not read the settings file, using defaults:', err.message);
}

function persist() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  // Write to a temp file first so a crash can't leave a half-written settings file
  const tmp = `${SETTINGS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SETTINGS_FILE);
}

const getApiKey = () => stored.openrouterApiKey || process.env.OPENROUTER_API_KEY || '';
const getModel = () => stored.openrouterModel || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;

/** What the browser may know: never the key itself, only whether one exists and its last characters */
function publicOpenRouter() {
  const key = getApiKey();
  return {
    configured: Boolean(key),
    source: stored.openrouterApiKey ? 'settings' : process.env.OPENROUTER_API_KEY ? 'env' : 'none',
    keyHint: key ? `…${key.slice(-4)}` : '',
    model: getModel(),
    defaultModel: DEFAULT_MODEL
  };
}

/** Apply a validated change: an empty string clears the saved value */
function update({ openrouterApiKey, openrouterModel }) {
  if (openrouterApiKey !== undefined) {
    if (openrouterApiKey) stored.openrouterApiKey = openrouterApiKey;
    else delete stored.openrouterApiKey;
  }
  if (openrouterModel !== undefined) {
    if (openrouterModel) stored.openrouterModel = openrouterModel;
    else delete stored.openrouterModel;
  }
  persist();
}

module.exports = { getApiKey, getModel, publicOpenRouter, update, DEFAULT_MODEL };
