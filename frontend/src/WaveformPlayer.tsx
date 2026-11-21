import React, { useCallback, useEffect, useRef, useState } from 'react';
import { registerAvatarAudio } from './avatarAudio';
import { formatTime } from './format';

const BARS = 56;

// Peak amplitude per bar, normalised to the loudest one, plus the decoded duration
async function decodePeaks(blob: Blob): Promise<{ peaks: number[]; duration: number }> {
  const Ctx = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const audio: AudioBuffer = await new Ctx(1, 1, 44100).decodeAudioData(await blob.arrayBuffer());
  const data = audio.getChannelData(0);
  const block = Math.max(1, Math.floor(data.length / BARS));
  const peaks: number[] = [];
  for (let i = 0; i < BARS; i++) {
    const start = i * block;
    const end = Math.min(data.length, start + block);
    const step = Math.max(1, Math.floor((end - start) / 200));
    let max = 0;
    for (let j = start; j < end; j += step) max = Math.max(max, Math.abs(data[j]));
    peaks.push(max);
  }
  const top = Math.max(...peaks) || 1;
  return { peaks: peaks.map((p) => Math.max(0.08, p / top)), duration: audio.duration };
}

const PLACEHOLDER = Array.from({ length: BARS }, () => 0.12);

const icon = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

interface WaveformPlayerProps {
  blob: Blob;
  /** Shown in the header, e.g. the file name */
  title: string;
  downloadName: string;
  autoPlay?: boolean;
  /** Extra buttons placed after Download */
  children?: React.ReactNode;
}

/** Equalizer-style player: bars fill as the audio plays, and dragging the bars seeks */
export function WaveformPlayer({ blob, title, downloadName, autoPlay, children }: WaveformPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [url, setUrl] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(false);

  // The avatar lip-syncs to whichever player is playing, so every <audio> element registers itself
  const unregisterRef = useRef<(() => void) | null>(null);
  const setAudio = useCallback((element: HTMLAudioElement | null) => {
    unregisterRef.current?.();
    unregisterRef.current = null;
    audioRef.current = element;
    if (element) unregisterRef.current = registerAvatarAudio(element);
  }, []);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    setPeaks(null);
    setCurrent(0);
    setPlaying(false);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);

  // Decode lazily: long lists only analyse the players that are actually on screen
  useEffect(() => {
    const root = rootRef.current;
    if (!root || visible) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    decodePeaks(blob)
      .then((result) => {
        if (cancelled) return;
        setPeaks(result.peaks);
        setDuration((d) => (Number.isFinite(d) && d > 0 ? d : result.duration));
      })
      .catch((err) => console.warn('Could not draw the waveform:', err));
    return () => {
      cancelled = true;
    };
  }, [blob, visible]);

  // Smooth playhead while playing
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setCurrent(audioRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch((err) => console.warn('Playback failed:', err));
    else audio.pause();
  };

  const seekTo = (seconds: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    audio.currentTime = Math.min(duration, Math.max(0, seconds));
    setCurrent(audio.currentTime);
  };

  const seekFromPointer = (event: React.PointerEvent) => {
    const rect = waveRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    seekTo(((event.clientX - rect.left) / rect.width) * duration);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') seekTo(current - 5);
    else if (event.key === 'ArrowRight') seekTo(current + 5);
    else if (event.key === 'Home') seekTo(0);
    else if (event.key === 'End') seekTo(duration);
    else if (event.key === ' ' || event.key === 'Enter') toggle();
    else return;
    event.preventDefault();
  };

  const progress = duration ? Math.min(1, current / duration) : 0;
  const bars = peaks || PLACEHOLDER;
  const extension = (downloadName.split('.').pop() || 'audio').toUpperCase();

  return (
    <div className="wp" ref={rootRef}>
      <div className="wp-head">
        <span className="wp-title">
          <svg {...icon} width={16} height={16}>
            <path d="M4 10v4M8 6v12M12 3v18M16 8v8M20 11v2" />
          </svg>
          <span>{title}</span>
        </span>
        <span className="wp-time">
          <b>{formatTime(current)}</b> / {formatTime(duration)}
        </span>
      </div>

      <div
        ref={waveRef}
        className={`wp-wave${peaks ? '' : ' is-loading'}`}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${formatTime(current)} of ${formatTime(duration)}`}
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          draggingRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e);
        }}
        onPointerMove={(e) => draggingRef.current && seekFromPointer(e)}
        onPointerUp={() => (draggingRef.current = false)}
        onPointerCancel={() => (draggingRef.current = false)}
      >
        {bars.map((peak, i) => (
          <span key={i} className={(i + 0.5) / BARS <= progress ? 'is-played' : ''} style={{ height: `${Math.round(peak * 100)}%` }} />
        ))}
        <i className="wp-handle" style={{ left: `${progress * 100}%` }} />
      </div>

      <div className="wp-controls">
        <button className="wp-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg {...icon} fill="currentColor" stroke="none" width={20} height={20}>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg {...icon} fill="currentColor" stroke="none" width={20} height={20}>
              <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
            </svg>
          )}
        </button>
        <button className="wp-skip" onClick={() => seekTo(current - 10)} aria-label="Back 10 seconds">
          <svg {...icon}>
            <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5M3.5 4v4.5H8" />
          </svg>
          <small>10</small>
        </button>
        <button className="wp-skip" onClick={() => seekTo(current + 10)} aria-label="Forward 10 seconds">
          <svg {...icon}>
            <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1l2.6 2.6M20.5 4v4.5H16" />
          </svg>
          <small>10</small>
        </button>
        <span className="wp-spacer" />
        {url && (
          <a className="btn btn-ghost btn-sm" href={url} download={downloadName}>
            Download {extension}
          </a>
        )}
        {children}
      </div>

      {url && (
        <audio
          ref={setAudio}
          src={url}
          preload="metadata"
          autoPlay={autoPlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setCurrent(0);
          }}
          onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setDuration(e.currentTarget.duration)}
        />
      )}
    </div>
  );
}
