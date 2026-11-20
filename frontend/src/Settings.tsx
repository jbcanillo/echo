import React, { useCallback, useEffect, useState } from 'react';
import { API_BASE, DEFAULT_SYNTH, LANGUAGES, SynthSettings, synthIsDefault } from './api';

interface OpenRouterInfo {
  configured: boolean;
  source: 'settings' | 'env' | 'none';
  keyHint: string;
  model: string;
  defaultModel: string;
}

interface SettingsProps {
  /** True while this page is the one shown, so the server state is refreshed on every visit */
  active: boolean;
  synth: SynthSettings;
  onSynthChange: (next: SynthSettings) => void;
}

const MODEL_SUGGESTIONS = ['openai/gpt-4o-mini', 'google/gemini-2.0-flash-001', 'anthropic/claude-3.5-haiku', 'meta-llama/llama-3.3-70b-instruct'];

interface SliderProps {
  id: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}

function Slider({ id, label, hint, min, max, step, value, defaultValue, format, onChange }: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className={value !== defaultValue ? 'is-changed' : ''}>
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${percent}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => onChange(defaultValue)}
      />
      <p className="hint">{hint}</p>
    </div>
  );
}

export function Settings({ active, synth, onSynthChange }: SettingsProps) {
  const [info, setInfo] = useState<OpenRouterInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/settings`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      setInfo(data.openrouter);
      setModelInput((current) => current || data.openrouter.model);
      setLoadError(null);
    } catch (err: any) {
      setLoadError(`Could not load the server settings: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    if (active) load();
  }, [active, load]);

  // PUT and TEST share the same plumbing: call, report, refresh
  const call = async (kind: 'save' | 'test' | 'remove', url: string, init: RequestInit, successText: string) => {
    setBusy(kind);
    setMessage(null);
    try {
      const response = await fetch(`${API_BASE}${url}`, { headers: { 'Content-Type': 'application/json' }, ...init });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `Request failed (HTTP ${response.status})`);
      if (data?.openrouter) setInfo(data.openrouter);
      setMessage({ kind: 'success', text: successText });
      return true;
    } catch (err: any) {
      setMessage({ kind: 'error', text: err.message });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    const body: Record<string, string> = { openrouterModel: modelInput.trim() };
    if (keyInput.trim()) body.openrouterApiKey = keyInput.trim();
    if (await call('save', '/api/settings', { method: 'PUT', body: JSON.stringify(body) }, 'Saved')) setKeyInput('');
  };

  const test = () =>
    call('test', '/api/settings/test', { method: 'POST', body: JSON.stringify(keyInput.trim() ? { openrouterApiKey: keyInput.trim() } : {}) }, 'The key works');

  const remove = async () => {
    if (!window.confirm('Remove the saved OpenRouter key from the server?')) return;
    if (await call('remove', '/api/settings', { method: 'PUT', body: JSON.stringify({ openrouterApiKey: '' }) }, 'Key removed')) setKeyInput('');
  };

  const set = (patch: Partial<SynthSettings>) => onSynthChange({ ...synth, ...patch });

  return (
    <>
      <div className="page-title">
        <h2>Settings</h2>
      </div>

      <section className="card" aria-labelledby="h-synth">
        <h2 id="h-synth">
          <span className="step">//</span> Synthesizer
        </h2>
        <p className="hint">Saved in this browser and applied to every voice you generate. Double-click a slider to reset it.</p>

        <Slider
          id="set-speed"
          label="Speed"
          hint="How fast the voice speaks. 1.0 is normal."
          min={0.6}
          max={1.5}
          step={0.05}
          value={synth.speed}
          defaultValue={DEFAULT_SYNTH.speed}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(speed) => set({ speed })}
        />
        <Slider
          id="set-expr"
          label="Expressiveness"
          hint="How much pitch and tone vary. Lower is steadier and flatter, higher is livelier but less predictable."
          min={0.1}
          max={1}
          step={0.05}
          value={synth.expressiveness}
          defaultValue={DEFAULT_SYNTH.expressiveness}
          format={(v) => v.toFixed(2)}
          onChange={(expressiveness) => set({ expressiveness })}
        />
        <Slider
          id="set-var"
          label="Rhythm variation"
          hint="How much the timing and pauses vary. Lower sounds more even."
          min={0}
          max={1.5}
          step={0.05}
          value={synth.variation}
          defaultValue={DEFAULT_SYNTH.variation}
          format={(v) => v.toFixed(2)}
          onChange={(variation) => set({ variation })}
        />

        <div className="field">
          <label htmlFor="set-lang">Language of the text</label>
          <select id="set-lang" value={synth.language} onChange={(e) => set({ language: e.target.value })}>
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          <p className="hint">The voice sample can be in any language, but the text should match this setting.</p>
        </div>

        <button className="btn btn-ghost btn-sm settings-reset" onClick={() => onSynthChange(DEFAULT_SYNTH)} disabled={synthIsDefault(synth)}>
          Reset to defaults
        </button>
      </section>

      <section className="card" aria-labelledby="h-or">
        <h2 id="h-or">
          <span className="step">//</span> OpenRouter
        </h2>
        <p className="hint">
          Powers <b>Write text</b> and <b>Polish wording</b>. Only your prompt or script is sent, never audio. Get a key at{' '}
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
            openrouter.ai/keys
          </a>
          .
        </p>

        {loadError && <div className="status-message error">{loadError}</div>}

        {info && (
          <div className="key-status">
            <span className={`chip ${info.configured ? 'chip-ok' : ''}`}>
              {info.configured ? `Key set ${info.keyHint}` : 'No key set'}
            </span>
            {info.source === 'env' && <span className="hint">From the server's .env file. A key saved here overrides it.</span>}
            {info.source === 'settings' && <span className="hint">Saved on the server.</span>}
          </div>
        )}

        <div className="field">
          <label htmlFor="or-key">{info?.configured ? 'Replace API key' : 'API key'}</label>
          <input
            id="or-key"
            type="password"
            className="text-input"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="sk-or-v1-…"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="hint">Stored on the server and never shown again. Anyone who can open this app can replace it, so keep Echo on a private network.</p>
        </div>

        <div className="field">
          <label htmlFor="or-model">Model</label>
          <input
            id="or-model"
            type="text"
            className="text-input"
            list="or-models"
            value={modelInput}
            onChange={(e) => setModelInput(e.target.value)}
            placeholder={info?.defaultModel || 'openai/gpt-4o-mini'}
            autoComplete="off"
            spellCheck={false}
          />
          <datalist id="or-models">
            {MODEL_SUGGESTIONS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <p className="hint">Any model ID from openrouter.ai/models. Leave empty to use the default.</p>
        </div>

        {message && (
          <div className={`status-message ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </div>
        )}

        <div className="settings-actions">
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy !== null}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={test} disabled={busy !== null || (!keyInput.trim() && !info?.configured)}>
            {busy === 'test' ? 'Testing…' : 'Test key'}
          </button>
          {info?.source === 'settings' && (
            <button className="btn btn-danger btn-sm" onClick={remove} disabled={busy !== null}>
              Remove saved key
            </button>
          )}
        </div>
      </section>

      <section className="card" aria-labelledby="h-docs">
        <h2 id="h-docs">
          <span className="step">//</span> Developers
        </h2>
        <p className="hint">Every endpoint Echo uses is documented and can be tried from the browser.</p>
        <a className="btn btn-secondary btn-sm docs-link" href={`${API_BASE}/api/docs`} target="_blank" rel="noreferrer">
          Open API docs (Swagger)
        </a>
      </section>
    </>
  );
}
