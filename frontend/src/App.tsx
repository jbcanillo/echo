import React, { useState, useRef, useCallback } from 'react';
import './index.css';

// Empty in dev and Docker (requests go through the Vite/nginx proxy); set VITE_BACKEND_URL to call the backend directly
const API_BASE = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/$/, '');
const MAX_TEXT_LENGTH = 1000;

function App() {
  const [audioSample, setAudioSample] = useState<File | null>(null);
  const [audioSampleUrl, setAudioSampleUrl] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [enhance, setEnhance] = useState(false);
  const [consent, setConsent] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Start recording
  const startRecording = useCallback(async () => {
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
        const extension = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const audioBlob = new Blob(audioChunksRef.current, { type });
        const filename = `sample_${Date.now()}.${extension}`;
        const file = new File([audioBlob], filename, { type });
        setAudioSample(file);
        setAudioSampleUrl(URL.createObjectURL(audioBlob));
        cleanup();
      };

      mediaRecorder.start();
      setIsRecording(true);
      setError(null);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((t) => t + 100);
      }, 100);
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setError('Unable to access microphone. Please check permissions.');
    }
  }, []);

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  // Cleanup recording
  const cleanup = useCallback(() => {
    setIsRecording(false);
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    // Stop all tracks
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stream?.getTracks().forEach((track) => track.stop());
    }
  }, []);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('audio/')) {
      setAudioSample(file);
      setAudioSampleUrl(URL.createObjectURL(file));
      setError(null);
    } else {
      setError('Please upload an audio file');
    }
    e.target.value = ''; // Reset input
  };

  // Generate voice
  const generateVoice = useCallback(async () => {
    if (!audioSample) {
      setError('Please provide an audio sample');
      return;
    }
    if (!text.trim()) {
      setError('Please enter text to synthesize');
      return;
    }
    if (!consent) {
      setError('Please confirm you have consent to clone this voice');
      return;
    }

    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    setGeneratedAudioUrl(null);

    const formData = new FormData();
    formData.append('voiceSample', audioSample);
    formData.append('text', text);
    formData.append('enhance', enhance.toString());
    formData.append('consent', consent.toString());

    try {
      const response = await fetch(`${API_BASE}/api/clone-voice`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || `Voice cloning failed (HTTP ${response.status})`);
      }

      // Get the audio blob URL
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      setGeneratedAudioUrl(audioUrl);
      setSuccess('Voice generated successfully!');
    } catch (err: any) {
      console.error('Generation error:', err);
      setError(err.message || 'An error occurred during voice generation');
    } finally {
      setIsGenerating(false);
    }
  }, [audioSample, text, enhance, consent]);

  // Reset form
  const resetForm = useCallback(() => {
    setAudioSample(null);
    if (audioSampleUrl) {
      URL.revokeObjectURL(audioSampleUrl);
    }
    setAudioSampleUrl(null);
    setText('');
    setEnhance(false);
    setConsent(false);
    setGeneratedAudioUrl(null);
    if (generatedAudioUrl) {
      URL.revokeObjectURL(generatedAudioUrl);
    }
    setError(null);
    setSuccess(null);
    // Stop recording if active
    if (isRecording) {
      stopRecording();
    }
  }, [audioSampleUrl, generatedAudioUrl, isRecording, stopRecording]);

  // Play generated audio
  const playGeneratedAudio = useCallback(() => {
    if (generatedAudioUrl && audioRef.current) {
      audioRef.current.src = generatedAudioUrl;
      audioRef.current.play();
    }
  }, [generatedAudioUrl]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Echo</h1>
        <p>Voice Cloning PWA</p>
      </header>

      <main className="app-main">
        {/* Audio Input Section */}
        <section className="input-section">
          <h2>Audio Sample</h2>
          <div className="audio-controls">
            <button 
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isGenerating}
              className={isRecording ? 'recording' : ''}
            >
              {isRecording ? 'Stop Recording' : 'Record Audio'}
            </button>
            <input 
              type="file"
              accept="audio/*"
              onChange={handleFileUpload}
              disabled={isGenerating}
            />
            {isRecording && (
              <div className="recording-timer">
                Recording: {(recordingTime / 1000).toFixed(1)}s
              </div>
            )}
          </div>

          {audioSampleUrl && (
            <div className="audio-preview">
              <h3>Preview:</h3>
              <audio controls src={audioSampleUrl} />
            </div>
          )}
        </section>

        {/* Text Input Section */}
        <section className="input-section">
          <h2>Text to Synthesize</h2>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Enter text to be spoken in the cloned voice"
            rows={4}
            maxLength={MAX_TEXT_LENGTH}
            disabled={isGenerating}
          />
          <div className="text-options">
            <label>
              <input
                type="checkbox"
                checked={enhance}
                onChange={(e) => setEnhance(e.target.checked)}
                disabled={isGenerating}
              />
              Enhance text via AI (OpenRouter)
            </label>
            <span className="character-count">
              {text.length}/{MAX_TEXT_LENGTH} characters
            </span>
          </div>
        </section>

        <section className="input-section consent-section">
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={isGenerating}
            />
            This is my voice, or I have the speaker's permission to clone it.
          </label>
        </section>

        {/* Action Controls */}
        <section className="action-controls">
          <button 
            onClick={generateVoice}
            disabled={!audioSample || !text.trim() || !consent || isGenerating}
            className="generate-button"
          >
            {isGenerating ? 'Generating...' : 'Generate Voice'}
          </button>
          <button 
            onClick={resetForm}
            disabled={isGenerating}
            className="reset-button"
          >
            Reset
          </button>
        </section>

        {/* Status Messages */}
        {error && (
          <div className="status-message error">
            {error}
          </div>
        )}
        {success && (
          <div className="status-message success">
            {success}
            <button onClick={() => setSuccess(null)} className="dismiss-button">
              ×
            </button>
          </div>
        )}

        {/* Output Section */}
        {generatedAudioUrl && (
          <section className="output-section">
            <h2>Generated Voice</h2>
            <div className="audio-player">
              <audio 
                ref={audioRef}
                controls
                src={generatedAudioUrl}
                autoPlay
              />
            </div>
            <div className="audio-actions">
              <button 
                onClick={playGeneratedAudio}
                className="play-button"
              >
                Play Again
              </button>
              <a
                href={generatedAudioUrl}
                download="cloned_voice.wav"
                className="download-button"
              >
                Download Audio
              </a>
            </div>
          </section>
        )}
      </main>

      <footer className="app-footer">
        <p>Echo Voice Cloning PWA • Built with React & Vite</p>
      </footer>
    </div>
  );
}

export default App;