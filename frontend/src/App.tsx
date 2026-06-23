import React, { useState, useRef, useCallback } from 'react';
import './index.css';

const API_BASE = '/api';

function App() {
  const [audioSample, setAudioSample] = useState<File | null>(null);
  const [audioSampleUrl, setAudioSampleUrl] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [enhance, setEnhance] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Start recording
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const filename = `sample_${Date.now()}.wav`;
        const file = new File([audioBlob], filename, { type: 'audio/wav' });
        setAudioSample(file);
        setAudioSampleUrl(URL.createObjectURL(audioBlob));
        cleanup();
      };

      mediaRecorder.start(10);
      setIsRecording(true);
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((t) => t + 10);
      }, 10);
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

    setIsGenerating(true);
    setError(null);
    setSuccess(null);
    setGeneratedAudioUrl(null);

    const formData = new FormData();
    formData.append('voiceSample', audioSample);
    formData.append('text', text);
    formData.append('enhance', enhance.toString());

    try {
      const response = await fetch(`${API_BASE}/api/clone-voice`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Voice cloning failed');
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
  }, [audioSample, text, enhance, API_BASE]);

  // Reset form
  const resetForm = useCallback(() => {
    setAudioSample(null);
    if (audioSampleUrl) {
      URL.revokeObjectURL(audioSampleUrl);
    }
    setAudioSampleUrl(null);
    setText('');
    setEnhance(false);
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
                Recording: {recordingTime / 1000}s
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
              {text.length} characters
            </span>
          </div>
        </section>

        {/* Action Controls */}
        <section className="action-controls">
          <button 
            onClick={generateVoice}
            disabled={!audioSample || !text.trim() || isGenerating}
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