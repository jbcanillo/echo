import React, { Suspense, lazy, useState, useRef, useCallback, useEffect } from 'react';
import './index.css';
import { Library } from './Library';
import { History } from './History';
import { WaveformPlayer } from './WaveformPlayer';
import { LiveMeter } from './LiveMeter';
import { Settings } from './Settings';
import { API_BASE, DEFAULT_SYNTH, loadAvatarGender, loadSynth, saveAvatarGender, saveSynth, type SynthSettings } from './api';
import type { AvatarGender } from './Avatar';
import { extensionFor, formatClock, formatTime, safeFilename } from './format';
import { HistoryItem, SavedVoice, addHistoryItem, clearHistory, deleteHistoryItem, deleteVoice, listHistory, listVoices, newId, saveVoice } from './db';

// Loaded separately so the 3D engine doesn't slow down the first paint
const Avatar = lazy(() => import('./Avatar'));

const MAX_TEXT_LENGTH = 5000;
// Recording: aim for ~30 s, stop automatically at a minute
const GOOD_RECORDING_MS = 20000;
const TARGET_RECORDING_MS = 30000;
const MAX_RECORDING_MS = 60000;

// Phonetically varied passage so the recording covers most sounds of English
const READING_PASSAGE =
  'The quick brown fox jumps over the lazy dog near the quiet river bank. ' +
  'Every morning, I walk through the garden and listen to the birds singing. ' +
  'Could you please tell me how much this costs? I think it is rather wonderful! ' +
  'Last summer we travelled to Spain, Japan, and Switzerland, and saw thirty-seven different museums. ' +
  'Whether the weather is warm or cold, we will gather together and enjoy a good, long conversation.';

type Tab = 'sample' | 'synthesize' | 'library' | 'history' | 'settings';
type SourceTab = 'record' | 'upload' | 'library';

// The script and AI prompt survive a reload (the consent box deliberately does not)
const DRAFT_KEY = 'echo.draft';
function loadDraft(): { text?: string; prompt?: string } {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

const svgProps = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const IconSample = () => (
  <svg {...svgProps}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
const IconSynth = () => (
  <svg {...svgProps}>
    <path d="M4 10v4M8 6v12M12 3v18M16 8v8M20 11v2" />
  </svg>
);
const IconSettings = () => (
  <svg {...svgProps}>
    <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="8" cy="17" r="2" />
  </svg>
);
const IconLibrary = () => (
  <svg {...svgProps}>
    <path d="M4 5v14M9 5v14M14 7l4-1.5 2 12.5-4 1z" />
  </svg>
);
const IconHistory = () => (
  <svg {...svgProps}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 4v4.5H8M12 8v4.5l3 1.8" />
  </svg>
);

function App() {
  const [tab, setTab] = useState<Tab>('sample');
  // The avatar is only loaded once the synthesize page has been opened
  const [synthVisited, setSynthVisited] = useState(false);
  const [synth, setSynth] = useState<SynthSettings>(loadSynth);
  const [gender, setGender] = useState<AvatarGender>(loadAvatarGender);
  const [sourceTab, setSourceTab] = useState<SourceTab>('record');

  const [audioSample, setAudioSample] = useState<File | null>(null);
  const [sampleLabel, setSampleLabel] = useState('');
  const [savedVoiceId, setSavedVoiceId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState('');

  const [prompt, setPrompt] = useState(() => loadDraft().prompt ?? '');
  const [isWriting, setIsWriting] = useState(false);
  const [text, setText] = useState(() => loadDraft().text ?? '');
  const [isPolishing, setIsPolishing] = useState(false);
  // Text as it was before the last polish, so the rewrite can be undone
  const [prePolishText, setPrePolishText] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [generatedBlob, setGeneratedBlob] = useState<Blob | null>(null);
  const [generatedName, setGeneratedName] = useState('cloned_voice.wav');
  const [isGenerating, setIsGenerating] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [voices, setVoices] = useState<SavedVoice[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLElement | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [micStream, setMicStream] = useState<MediaStream | null>(null);

  const refreshVoices = useCallback(() => {
    listVoices().then(setVoices).catch((err) => console.warn('Could not load the voice library:', err));
  }, []);
  const refreshHistory = useCallback(() => {
    listHistory().then(setHistory).catch((err) => console.warn('Could not load the history:', err));
  }, []);

  useEffect(() => {
    refreshVoices();
    refreshHistory();
  }, [refreshVoices, refreshHistory]);

  useEffect(() => saveSynth(synth), [synth]);
  useEffect(() => saveAvatarGender(gender), [gender]);

  // Keep the draft
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ text, prompt }));
    } catch {
      /* storage unavailable: the draft just won't survive a reload */
    }
  }, [text, prompt]);

  // Time the (possibly minutes-long) generation so the wait doesn't feel stuck
  useEffect(() => {
    if (!isGenerating) return;
    setElapsed(0);
    const started = Date.now();
    const interval = setInterval(() => setElapsed(Date.now() - started), 1000);
    return () => clearInterval(interval);
  }, [isGenerating]);

  // Bring the result into view when it arrives
  useEffect(() => {
    if (generatedBlob) outputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [generatedBlob]);

  // Make a file the current sample
  const pickSample = useCallback((file: File, label: string, voiceId: string | null) => {
    setAudioSample(file);
    setSampleLabel(label);
    setSavedVoiceId(voiceId);
    setSaveName(voiceId ? label : '');
    setError(null);
  }, []);

  // Cleanup recording
  const cleanup = useCallback(() => {
    setIsRecording(false);
    setMicStream(null);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    // Stop all tracks
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
    }
  }, []);

  // Start recording
  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Recording needs a secure connection (HTTPS or localhost). Upload an audio file instead, or open Echo over HTTPS.');
      setSourceTab('upload');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm', 'audio/ogg', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const type = mediaRecorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type });
        const file = new File([audioBlob], `sample_${Date.now()}.${extensionFor(type)}`, { type });
        pickSample(file, file.name, null);
        cleanup();
      };

      mediaRecorder.start();
      setMicStream(stream);
      setIsRecording(true);
      setError(null);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((t) => t + 100);
      }, 100);
    } catch (err: any) {
      console.error('Error accessing microphone:', err);
      setError(
        err?.name === 'NotAllowedError'
          ? "Microphone access was blocked. Allow it in your browser's site settings, then try again."
          : 'Unable to access the microphone. Check that one is connected and not used by another app.'
      );
    }
  }, [cleanup, pickSample]);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    if (isRecording && recordingTime >= MAX_RECORDING_MS) stopRecording();
  }, [isRecording, recordingTime, stopRecording]);

  useEffect(() => {
    if (tab === 'synthesize') setSynthVisited(true);
    // A recording can't continue once you leave the sample page
    if (tab !== 'sample') stopRecording();
  }, [tab, stopRecording]);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      pickSample(file, file.name, null);
    } else {
      setError('Please upload an audio file');
    }
    e.target.value = ''; // Reset input
  };

  // Drop the current sample and return to the source picker (for Retake, optionally recording straight away)
  const clearSample = useCallback(
    (thenRecord: boolean) => {
      setAudioSample(null);
      setSampleLabel('');
      setSavedVoiceId(null);
      setSaveName('');
      if (thenRecord) {
        setSourceTab('record');
        startRecording();
      }
    },
    [startRecording]
  );

  // Library actions
  const saveToLibrary = useCallback(async () => {
    if (!audioSample) return;
    const name = saveName.trim() || sampleLabel;
    const voice: SavedVoice = { id: newId(), name, blob: audioSample, createdAt: Date.now() };
    try {
      await saveVoice(voice);
      setSavedVoiceId(voice.id);
      setSampleLabel(name);
      refreshVoices();
      setSuccess(`Saved “${name}” to your library`);
    } catch (err) {
      console.error('Saving the voice failed:', err);
      setError('Could not save to the library (storage may be unavailable)');
    }
  }, [audioSample, saveName, sampleLabel, refreshVoices]);

  const useLibraryVoice = useCallback(
    (voice: SavedVoice) => {
      const file = new File([voice.blob], `${safeFilename(voice.name)}.${extensionFor(voice.blob.type)}`, { type: voice.blob.type });
      pickSample(file, voice.name, voice.id);
    },
    [pickSample]
  );

  const removeVoice = useCallback(
    async (id: string) => {
      await deleteVoice(id).catch((err) => console.warn('Delete failed:', err));
      if (id === savedVoiceId) setSavedVoiceId(null);
      refreshVoices();
    },
    [savedVoiceId, refreshVoices]
  );

  const removeHistoryItem = useCallback(
    async (id: string) => {
      await deleteHistoryItem(id).catch((err) => console.warn('Delete failed:', err));
      refreshHistory();
    },
    [refreshHistory]
  );

  const clearAllHistory = useCallback(async () => {
    if (!window.confirm('Delete all generated audio from this device?')) return;
    await clearHistory().catch((err) => console.warn('Clear failed:', err));
    refreshHistory();
  }, [refreshHistory]);

  const reuseText = useCallback((item: HistoryItem) => {
    setText(item.text);
    setPrePolishText(null);
    setTab('synthesize');
  }, []);

  // Ask the AI to write the text to be spoken
  const generateText = useCallback(async () => {
    if (!prompt.trim()) return;
    setIsWriting(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/generate-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `Text generation failed (HTTP ${response.status})`);
      }
      setText(data.text);
      setPrePolishText(null);
    } catch (err: any) {
      console.error('Text generation error:', err);
      setError(err.message || 'An error occurred during text generation');
    } finally {
      setIsWriting(false);
    }
  }, [prompt]);

  // Rewrite the current text in place so it sounds natural when spoken
  const polishText = useCallback(async () => {
    if (!text.trim()) return;
    setIsPolishing(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE}/api/enhance-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `Polishing failed (HTTP ${response.status})`);
      }
      setPrePolishText(text);
      setText(data.text);
    } catch (err: any) {
      console.error('Polish error:', err);
      setError(err.message || 'An error occurred while polishing the text');
    } finally {
      setIsPolishing(false);
    }
  }, [text]);

  // Generate voice
  const generateVoice = useCallback(async () => {
    if (!audioSample || !text.trim() || !consent) return;

    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    setGeneratedBlob(null);

    const formData = new FormData();
    formData.append('voiceSample', audioSample);
    formData.append('text', text);
    formData.append('consent', consent.toString());
    formData.append('language', synth.language);
    // Only send tuning the user changed; otherwise the model's own defaults apply
    for (const key of ['speed', 'expressiveness', 'variation'] as const) {
      if (synth[key] !== DEFAULT_SYNTH[key]) formData.append(key, String(synth[key]));
    }

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch(`${API_BASE}/api/clone-voice`, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `Voice cloning failed (HTTP ${response.status})`);
      }

      const audioBlob = await response.blob();
      const voiceName = sampleLabel || 'Voice';
      setGeneratedName(`${safeFilename(voiceName)}_${Date.now()}.wav`);
      setGeneratedBlob(audioBlob);
      setSuccess('Voice generated. It was also saved to your history.');
      // Keep a copy on this device; failing to save must not fail the generation
      addHistoryItem({ id: newId(), text: text.trim(), voiceName, blob: audioBlob, createdAt: Date.now() })
        .then(refreshHistory)
        .catch((err) => console.warn('Could not save to history:', err));
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setSuccess('Generation cancelled.');
      } else {
        console.error('Generation error:', err);
        setError(err.message || 'An error occurred during voice generation');
      }
    } finally {
      abortRef.current = null;
      setIsGenerating(false);
    }
  }, [audioSample, text, consent, sampleLabel, synth, refreshHistory]);

  // Reset form
  const resetForm = useCallback(() => {
    if (isRecording) {
      stopRecording();
    }
    setAudioSample(null);
    setSampleLabel('');
    setSavedVoiceId(null);
    setSaveName('');
    setPrompt('');
    setText('');
    setPrePolishText(null);
    setConsent(false);
    setGeneratedBlob(null);
    setError(null);
    setSuccess(null);
  }, [isRecording, stopRecording]);

  const busy = isGenerating || isWriting || isPolishing;

  // What is still needed before the voice can be generated
  const missing = !audioSample ? 'Add a voice sample' : !text.trim() ? 'Write or paste the script' : !consent ? 'Confirm you have permission to use this voice' : '';
  const steps = [
    { label: 'Voice', done: !!audioSample },
    { label: 'Script', done: !!text.trim() },
    { label: 'Consent', done: consent }
  ];

  // The Voice step lives on the sample page, the other two on the synthesize page
  const stepper = (
    <ol className="stepper" aria-label="Progress">
      {steps.map((step, i) => (
        <li key={step.label}>
          <button className={step.done ? 'is-done' : ''} onClick={() => setTab(i === 0 ? 'sample' : 'synthesize')} disabled={isRecording}>
            <span className="stepper-dot">{step.done ? '✓' : i + 1}</span>
            {step.label}
          </button>
        </li>
      ))}
    </ol>
  );

  const messages = (
    <>
      {error && (
        <div className="status-message error" role="alert">
          {error}
          <button onClick={() => setError(null)} className="dismiss-button" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      {success && (
        <div className="status-message success" role="status">
          {success}
          <button onClick={() => setSuccess(null)} className="dismiss-button" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </>
  );

  const recordingHint =
    recordingTime >= GOOD_RECORDING_MS ? 'Great length. Stop whenever you are ready.' : `Keep reading. Aim for at least ${GOOD_RECORDING_MS / 1000} seconds.`;

  return (
    <div className="app">
      <header className="app-header">
        <img className="app-logo" src={`${import.meta.env.BASE_URL}logo.webp`} alt="" width={44} height={44} />
        <div className="app-title">
          <h1>Echo</h1>
          <p>Voice cloning studio</p>
        </div>
        <button
          className={`icon-btn${tab === 'settings' ? ' is-active' : ''}`}
          onClick={() => setTab(tab === 'settings' ? 'sample' : 'settings')}
          disabled={isRecording}
          aria-label="Settings"
          aria-current={tab === 'settings' ? 'page' : undefined}
        >
          <IconSettings />
        </button>
      </header>

      {/* Pages stay mounted (just hidden) so recordings, scripts and generated audio survive tab switches */}

      {/* PAGE 1: voice sample */}
      <main className="panel" data-active={tab === 'sample'}>
        {stepper}

        <section className="card" aria-labelledby="h-sample">
          <h2 id="h-sample">
            <span className="step">01 //</span> Voice sample
          </h2>

          <div className="segmented" role="tablist" aria-label="Sample source">
            {(
              [
                ['record', 'Record'],
                ['upload', 'Upload'],
                ['library', `Library${voices.length ? ` (${voices.length})` : ''}`]
              ] as const
            ).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={sourceTab === id} onClick={() => setSourceTab(id)} disabled={isRecording}>
                {label}
              </button>
            ))}
          </div>

          {audioSample && !isRecording ? (
            <div className="sample-preview">
              <WaveformPlayer blob={audioSample} title={sampleLabel || audioSample.name} downloadName={audioSample.name}>
                <button className="btn btn-ghost btn-sm" onClick={() => clearSample(sourceTab === 'record')}>
                  {sourceTab === 'record' ? 'Retake' : 'Change'}
                </button>
              </WaveformPlayer>
              <div className="sample-actions">
                {savedVoiceId ? (
                  <span className="chip chip-ok">Saved in library</span>
                ) : (
                  <>
                    <input
                      type="text"
                      className="name-input"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      placeholder="Name this voice to reuse it later"
                      maxLength={40}
                      aria-label="Voice name"
                    />
                    <button className="btn btn-secondary btn-sm" onClick={saveToLibrary}>
                      Save to library
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : sourceTab === 'record' ? (
            <>
              <div className="reading">
                <span className="label">Read this aloud in your natural voice</span>
                <blockquote className="reading-passage">{READING_PASSAGE}</blockquote>
                <details className="tips">
                  <summary>Recording tips</summary>
                  <ul>
                    <li>Find a quiet room and hold the microphone about a hand-width from your mouth.</li>
                    <li>Speak clearly at a steady pace with normal expression. Don't whisper or shout.</li>
                    <li>Re-record if you stumble or hear background noise.</li>
                  </ul>
                </details>
              </div>

              {isRecording && micStream && (
                <div className="recording-panel">
                  <LiveMeter stream={micStream} />
                  <div className="goal" aria-hidden="true">
                    <div className="goal-fill" style={{ width: `${Math.min(100, (recordingTime / TARGET_RECORDING_MS) * 100)}%` }} />
                  </div>
                  <p className="hint">{recordingHint}</p>
                </div>
              )}

              <div className="record-row">
                <button
                  className={`btn record-btn${isRecording ? ' is-recording' : ''}`}
                  onClick={isRecording ? stopRecording : startRecording}
                  disabled={isGenerating}
                >
                  <span className="rec-dot" aria-hidden="true" />
                  {isRecording ? 'Stop recording' : 'Start recording'}
                </button>
                <span className={`clock${isRecording ? ' live' : ''}`}>{formatClock(recordingTime)}</span>
              </div>
            </>
          ) : sourceTab === 'upload' ? (
            <>
              <input type="file" accept="audio/*" onChange={handleFileUpload} disabled={isGenerating} aria-label="Upload an audio sample" />
              <p className="hint">Clear speech, 20–30 seconds, no music or background noise works best.</p>
            </>
          ) : (
            <Library voices={voices} activeId={savedVoiceId} onUse={useLibraryVoice} onDelete={removeVoice} />
          )}
        </section>

        {messages}

        <button className="btn btn-primary btn-lg" onClick={() => setTab('synthesize')} disabled={!audioSample || isRecording}>
          Continue to script
        </button>
        {!audioSample && <p className="hint next-step">Record, upload or pick a voice to continue</p>}
      </main>

      {/* PAGE 2: script, synthesis and the avatar */}
      <section className="panel" data-active={tab === 'synthesize'} aria-label="Synthesize">
        {synthVisited && (
          <Suspense fallback={null}>
            <Avatar micStream={null} isThinking={isGenerating} audioElement={audioElement} gender={gender} />
          </Suspense>
        )}

        <div className="segmented avatar-toggle" role="radiogroup" aria-label="Avatar">
          {(
            [
              ['F', 'Female'],
              ['M', 'Male']
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="radio" aria-checked={gender === id} onClick={() => setGender(id)}>
              {label}
            </button>
          ))}
        </div>

        {stepper}

        <div className="voice-summary">
          <div>
            <span className="label">Voice</span>
            <strong>{audioSample ? sampleLabel || audioSample.name : 'None selected'}</strong>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setTab('sample')} disabled={isGenerating}>
            {audioSample ? 'Change' : 'Choose voice'}
          </button>
        </div>

        <section className="card" aria-labelledby="h-text">
          <h2 id="h-text">
            <span className="step">02 //</span> Script
          </h2>

          <div className="prompt-box">
            <label htmlFor="ai-prompt">Let AI write it for you (optional)</label>
            <textarea
              id="ai-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Write me a 5 paragraph bedtime short story about friendly monsters"
              rows={2}
              maxLength={1000}
              disabled={busy}
            />
            <div className="prompt-foot">
              <p className="hint">
                Needs an OpenRouter key from{' '}
                <button className="link-btn" onClick={() => setTab('settings')}>
                  Settings
                </button>
                . The result appears below, ready to edit.
              </p>
              <button className="btn btn-secondary btn-sm" onClick={generateText} disabled={!prompt.trim() || busy} aria-busy={isWriting}>
                {isWriting ? 'Writing…' : 'Write text'}
              </button>
            </div>
          </div>

          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPrePolishText(null);
            }}
            placeholder="Type or paste what the cloned voice should say"
            rows={6}
            maxLength={MAX_TEXT_LENGTH}
            disabled={isGenerating || isPolishing}
            aria-label="Text to synthesize"
          />
          <div className="text-options">
            <div className="polish-actions">
              <button className="btn btn-secondary btn-sm" onClick={polishText} disabled={!text.trim() || busy} aria-busy={isPolishing}>
                {isPolishing ? 'Polishing…' : 'Polish wording'}
              </button>
              {prePolishText !== null && !isPolishing && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setText(prePolishText);
                    setPrePolishText(null);
                  }}
                >
                  Undo
                </button>
              )}
            </div>
            <span className="counter">
              {text.length}/{MAX_TEXT_LENGTH}
            </span>
          </div>
        </section>

        {/* Consent */}
        <label className={`consent${consent ? ' is-on' : ''}`}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} disabled={isGenerating} />
          <span>This is my voice, or I have the speaker's permission to clone it.</span>
        </label>

        {messages}

        {isGenerating ? (
          <div className="generating" role="status">
            <div className="generating-info">
              <strong>Generating voice… {formatTime(elapsed / 1000)}</strong>
              <span>The first run downloads the voice model, and long scripts take a while on CPU. You can leave this page open.</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="actions-wrap">
            <div className="actions">
              <button onClick={generateVoice} disabled={!!missing || busy} className="btn btn-primary btn-lg">
                Synthesize audio
              </button>
              <button onClick={resetForm} disabled={busy} className="btn btn-ghost btn-lg">
                Reset
              </button>
            </div>
            {missing && <p className="hint next-step">Next: {missing}</p>}
          </div>
        )}

        {/* Output */}
        {generatedBlob && (
          <section className="card card-glow" aria-labelledby="h-out" ref={outputRef}>
            <h2 id="h-out">
              <span className="step">03 //</span> Generated voice
            </h2>
            <WaveformPlayer blob={generatedBlob} title={generatedName} downloadName={generatedName} autoPlay onAudioElement={setAudioElement} />
          </section>
        )}
      </section>

      <section className="panel" data-active={tab === 'library'} aria-label="Voice library">
        <div className="page-title">
          <h2>Library</h2>
          <span className="meta">{voices.length} saved</span>
        </div>
        <Library
          voices={voices}
          activeId={savedVoiceId}
          onUse={(voice) => {
            useLibraryVoice(voice);
            setTab('synthesize');
          }}
          onDelete={removeVoice}
        />
      </section>

      <section className="panel" data-active={tab === 'history'} aria-label="Generation history">
        <div className="page-title">
          <h2>History</h2>
          <span className="meta">{history.length} generated</span>
        </div>
        <History items={history} onReuse={reuseText} onDelete={removeHistoryItem} onClear={clearAllHistory} />
      </section>

      <section className="panel" data-active={tab === 'settings'} aria-label="Settings">
        <Settings active={tab === 'settings'} synth={synth} onSynthChange={setSynth} />
      </section>

      <nav className="dock" aria-label="Main">
        {(
          [
            ['sample', 'Sample', <IconSample key="s" />],
            ['synthesize', 'Synthesize', <IconSynth key="y" />],
            ['library', 'Library', <IconLibrary key="l" />],
            ['history', 'History', <IconHistory key="h" />]
          ] as const
        ).map(([id, label, icon]) => (
          <button key={id} className={tab === id ? 'is-active' : ''} aria-label={label} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            {icon}
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default App;
