import React, { useEffect, useRef, useState } from 'react';
import { TalkingHead } from '@met4citizen/talkinghead';
import { HeadAudio } from '@met4citizen/headaudio/dist/headaudio.min.mjs';
import { connectAvatarAudio } from './avatarAudio';
import { getCustomAvatar } from './db';
import headWorkletUrl from '@met4citizen/headaudio/dist/headworklet.min.mjs?url';
import visemeModelUrl from '@met4citizen/headaudio/dist/model-en-mixed.bin?url';

export type AvatarGender = 'F' | 'M';

// One GLB per gender. Replace these files (or point to other GLBs) to change the avatars. A model needs a
// Mixamo-compatible rig plus ARKit and Oculus viseme blend shapes; see the TalkingHead README.
// If male.glb is missing, the male option falls back to generic.glb with the male body type.
const MODEL_URLS: Record<AvatarGender, string> = {
  F: `${import.meta.env.BASE_URL}avatars/generic.glb`,
  M: `${import.meta.env.BASE_URL}avatars/male.glb`
};

// The dev server and nginx answer unknown paths with index.html, so check for the GLB magic number
async function isGlb(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-3' } });
    const reader = response.body?.getReader();
    if (!response.ok || !reader) return false;
    const { value } = await reader.read();
    reader.cancel().catch(() => undefined);
    return !!value && String.fromCharCode(...value.slice(0, 4)) === 'glTF';
  } catch {
    return false;
  }
}

interface ModelResult {
  /** The built-in model for the other gender had to stand in because this one isn't installed */
  usedDefault: boolean;
  /** The user's own model could not be loaded, so the built-in one is shown instead */
  customFailed: boolean;
}

/** Shows the built-in avatar for a gender (the female one stands in if there is no male.glb) */
async function showDefaultModel(head: TalkingHead, gender: AvatarGender, onProgress: (event: ProgressEvent) => void): Promise<boolean> {
  let url = MODEL_URLS[gender];
  let usedDefault = false;
  if (gender === 'M' && !(await isGlb(url))) {
    url = MODEL_URLS.F;
    usedDefault = true;
  }
  await head.showAvatar({ url, body: gender, avatarMood: 'neutral', lipsyncLang: 'en' }, onProgress);
  return usedDefault;
}

/** Shows the user's own avatar for a gender if they uploaded one in Settings, otherwise the built-in one */
async function showModel(head: TalkingHead, gender: AvatarGender, onProgress: (event: ProgressEvent) => void): Promise<ModelResult> {
  const custom = await getCustomAvatar(gender).catch(() => undefined);
  let customFailed = false;
  if (custom?.blob) {
    const url = URL.createObjectURL(custom.blob);
    try {
      await head.showAvatar({ url, body: gender, avatarMood: 'neutral', lipsyncLang: 'en' }, onProgress);
      return { usedDefault: false, customFailed: false };
    } catch (err) {
      console.warn('The custom avatar could not be loaded, using the built-in one:', err);
      customFailed = true;
    } finally {
      URL.revokeObjectURL(url); // the loader has read it by now, or failed
    }
  }
  return { usedDefault: await showDefaultModel(head, gender, onProgress), customFailed };
}

// HeadAudio needs ~100 ms to detect a viseme, so the audible speech is delayed to match the lips
const LIPSYNC_DELAY_SECONDS = 0.1;

// Decorative waveform behind the avatar: fixed pseudo-random heights, gold in the middle and
// emerald at the edges (--c is the closeness to the center), each bar with its own pace
const WAVE_BARS = Array.from({ length: 61 }, (_, i) => {
  const center = 1 - Math.abs(i - 30) / 30;
  const noise = Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
  return {
    '--h': (0.25 + 0.75 * noise) * (0.35 + 0.65 * Math.sqrt(center)),
    '--c': center,
    '--d': `${(0.35 + noise * 0.6).toFixed(2)}s`
  } as React.CSSProperties;
});

// An <audio> element can only ever be wired into one Web Audio source node
const mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

interface AvatarProps {
  /** Microphone stream while recording; the avatar listens to it */
  micStream: MediaStream | null;
  /** True while the voice is being generated */
  isThinking: boolean;
  /** Which avatar to show; changing it swaps the model without rebuilding the audio setup */
  gender: AvatarGender;
  /** Bumped when the user uploads or removes a custom avatar in Settings, to reload the model */
  customVersion: number;
}

function Avatar({ micStream, isThinking, gender, customVersion }: AvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [head, setHead] = useState<TalkingHead | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [usedDefault, setUsedDefault] = useState(false);
  const [customFailed, setCustomFailed] = useState(false);
  // The gender (and custom-avatar version) the shown model was loaded for, and the ones most recently asked for
  const loadedGenderRef = useRef<AvatarGender | null>(null);
  const loadedVersionRef = useRef(customVersion);
  const wantedGenderRef = useRef(gender);
  wantedGenderRef.current = gender;
  const wantedVersionRef = useRef(customVersion);
  wantedVersionRef.current = customVersion;

  // Load the avatar and the audio-driven lip-sync
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Each load gets its own element, so cleaning up one instance can't remove another's canvas
    const node = document.createElement('div');
    node.className = 'avatar-canvas';
    container.appendChild(node);
    let disposed = false;
    let instance: TalkingHead | null = null;

    const dispose = () => {
      try {
        instance?.dispose();
      } catch (err) {
        console.warn('Avatar cleanup error:', err);
      }
      node.remove();
    };

    (async () => {
      try {
        instance = new TalkingHead(node, {
          ttsEndpoint: '', // speech comes from Echo's backend, not TalkingHead's TTS
          lipsyncModules: [], // lips are driven by the audio itself (HeadAudio), not by text
          lipsyncLang: 'en',
          cameraView: 'head',
          cameraRotateEnable: false, // keep touch scrolling working over the avatar
          modelPixelRatio: Math.min(window.devicePixelRatio || 1, 2)
        });
        const initialGender = wantedGenderRef.current;
        const initialVersion = wantedVersionRef.current;
        const result = await showModel(instance, initialGender, (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        });
        loadedGenderRef.current = initialGender;
        loadedVersionRef.current = initialVersion;
        setUsedDefault(result.usedDefault);
        setCustomFailed(result.customFailed);

        const head = instance;
        const { audioCtx } = head;
        if (disposed) return;

        // Precise viseme lip-sync needs an AudioWorklet, which browsers only allow in secure contexts
        // (HTTPS or localhost). Anywhere else, or if setup fails, fall back to a simple loudness-driven mouth.
        let preciseLipSync = false;
        if (audioCtx.audioWorklet) {
          try {
            await audioCtx.audioWorklet.addModule(headWorkletUrl);
            const headAudio = new HeadAudio(audioCtx, {
              parameterData: { vadGateActiveDb: -40, vadGateInactiveDb: -60 }
            });
            await headAudio.loadModel(visemeModelUrl);
            if (disposed) return;

            head.audioSpeechGainNode.connect(headAudio);
            const delay = new DelayNode(audioCtx, { delayTime: LIPSYNC_DELAY_SECONDS });
            head.audioSpeechGainNode.disconnect(head.audioReverbNode);
            head.audioSpeechGainNode.connect(delay);
            delay.connect(head.audioReverbNode);

            headAudio.onvalue = (key, value) => {
              const target = head.mtAvatar[key];
              if (target) Object.assign(target, { newvalue: value, needsUpdate: true });
            };
            head.opt.update = headAudio.update.bind(headAudio);

            // Look at the viewer and gesture when a new sentence starts
            let lastEnded = 0;
            headAudio.onended = () => {
              lastEnded = Date.now();
            };
            headAudio.onstarted = () => {
              if (Date.now() - lastEnded > 150) {
                head.lookAtCamera(500);
                head.speakWithHands();
              }
            };
            preciseLipSync = true;
          } catch (err) {
            console.warn('Precise lip-sync unavailable, using the simple one:', err);
          }
        } else {
          console.warn('AudioWorklet unavailable (insecure context?); using simple lip-sync. Serve Echo over HTTPS for full lip-sync.');
        }

        if (!preciseLipSync) {
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          head.audioSpeechGainNode.connect(analyser);
          const samples = new Uint8Array(analyser.fftSize);
          let level = 0;
          head.opt.update = () => {
            analyser.getByteTimeDomainData(samples);
            let sum = 0;
            for (const s of samples) sum += ((s - 128) / 128) ** 2;
            const loudness = Math.min(1, Math.sqrt(sum / samples.length) * 4);
            level += (loudness - level) * 0.4; // smooth the jaw so it doesn't flutter
            for (const [key, scale] of [['jawOpen', 0.7], ['viseme_aa', 0.5]] as const) {
              const target = head.mtAvatar[key];
              if (target) Object.assign(target, { newvalue: level * scale, needsUpdate: true });
            }
          };
        }

        setHead(head);
      } catch (err) {
        if (!disposed) {
          console.error('Avatar failed to load:', err);
          setFailed(true);
        }
      } finally {
        // Loading finished after unmount: showAvatar restarted the render loop, so dispose again
        if (disposed) dispose();
      }
    })();

    return () => {
      disposed = true;
      setHead(null);
      dispose();
    };
  }, []);

  // Swap the model when the gender or the user's custom avatar changes, keeping the same audio and lip-sync setup
  useEffect(() => {
    if (!head || (loadedGenderRef.current === gender && loadedVersionRef.current === customVersion)) return;
    let cancelled = false;
    setSwitching(true);
    setProgress(0);
    showModel(head, gender, (event) => {
      if (!cancelled && event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    })
      .then((result) => {
        loadedGenderRef.current = gender;
        loadedVersionRef.current = customVersion;
        if (!cancelled) {
          setUsedDefault(result.usedDefault);
          setCustomFailed(result.customFailed);
        }
      })
      .catch((err) => console.error('Switching the avatar failed:', err))
      .finally(() => !cancelled && setSwitching(false));
    return () => {
      cancelled = true;
    };
  }, [head, gender, customVersion]);

  // Browsers keep the audio context suspended until the user interacts with the page
  useEffect(() => {
    if (!head) return;
    const resume = () => {
      if (head.audioCtx.state === 'suspended') head.audioCtx.resume();
    };
    document.addEventListener('pointerdown', resume);
    document.addEventListener('keydown', resume);
    return () => {
      document.removeEventListener('pointerdown', resume);
      document.removeEventListener('keydown', resume);
    };
  }, [head]);

  // Listening: follow the microphone while recording
  useEffect(() => {
    if (!head || !micStream) return;
    const source = head.audioCtx.createMediaStreamSource(micStream);
    const analyser = head.audioCtx.createAnalyser();
    source.connect(analyser);
    head.startListening(analyser);
    head.lookAtCamera(1000);
    return () => {
      head.stopListening();
      source.disconnect();
    };
  }, [head, micStream]);

  // Thinking: ponder while the voice is generated
  useEffect(() => {
    if (!head || !isThinking) return;
    const think = () => head.playGesture('🤔', 3);
    think();
    const interval = setInterval(think, 5000);
    return () => {
      clearInterval(interval);
      head.stopGesture();
    };
  }, [head, isThinking]);

  // Speaking: route every player's audio through the avatar so its lips follow whichever one is playing
  useEffect(() => {
    if (!head) return;
    const playing = new Set<HTMLAudioElement>();
    const wired = new Map<HTMLAudioElement, { source: MediaElementAudioSourceNode; onPlay: () => void; onStop: () => void }>();

    const update = () => {
      const speaking = playing.size > 0;
      head.isSpeaking = speaking;
      head.stateName = speaking ? 'speaking' : 'idle';
      if (speaking) {
        head.audioCtx.resume();
        head.lookAtCamera(500);
      }
      setIsSpeaking(speaking);
    };

    const attach = (element: HTMLAudioElement) => {
      if (wired.has(element)) return;
      let source = mediaSources.get(element);
      try {
        if (!source) {
          source = head.audioCtx.createMediaElementSource(element);
          mediaSources.set(element, source);
        }
        source.connect(head.audioSpeechGainNode);
      } catch (err) {
        // The element is already tied to another audio context, so it keeps playing on its own, without lip-sync
        console.warn('Could not connect a player to the avatar:', err);
        return;
      }
      const onPlay = () => {
        playing.add(element);
        update();
      };
      const onStop = () => {
        playing.delete(element);
        update();
      };
      element.addEventListener('play', onPlay);
      element.addEventListener('pause', onStop);
      element.addEventListener('ended', onStop);
      wired.set(element, { source, onPlay, onStop });
      if (!element.paused && !element.ended) onPlay();
    };

    const detach = (element: HTMLAudioElement) => {
      const entry = wired.get(element);
      if (!entry) return;
      element.removeEventListener('play', entry.onPlay);
      element.removeEventListener('pause', entry.onStop);
      element.removeEventListener('ended', entry.onStop);
      wired.delete(element);
      playing.delete(element);
      update();
      // A player that is going away no longer needs to be heard
      try {
        entry.source.disconnect();
      } catch {
        /* already disconnected */
      }
    };

    const disconnect = connectAvatarAudio({ attach, detach });
    return () => {
      disconnect();
      for (const element of [...wired.keys()]) detach(element);
    };
  }, [head]);

  let state = 'idle';
  let status = '';
  if (failed) {
    state = 'offline';
    status = 'Avatar unavailable on this device';
  } else if (!head || switching) {
    state = 'loading';
    status = `Loading avatar… ${progress}%`;
  } else if (micStream) {
    state = 'listening';
    status = 'Listening…';
  } else if (isThinking) {
    state = 'thinking';
    status = 'Thinking…';
  } else if (isSpeaking) {
    state = 'speaking';
    status = 'Speaking…';
  }

  return (
    <section className={`avatar${failed ? ' avatar-failed' : ''}`} data-state={state} aria-label="Avatar">
      <div className="avatar-stagewrap">
        <div className="avatar-wave" aria-hidden="true">
          {WAVE_BARS.map((bar, i) => (
            <span key={i} style={bar} />
          ))}
        </div>
        <div className="avatar-frame">
          <div ref={containerRef} className="avatar-stage" />
        </div>
      </div>
      <p className="avatar-status" role="status">{status}</p>
      {customFailed && !failed && (
        <p className="avatar-note">
          Your custom {gender === 'M' ? 'male' : 'female'} avatar could not be loaded, so the built-in one is shown. Check it in Settings → Avatars.
        </p>
      )}
      {usedDefault && gender === 'M' && !customFailed && !failed && (
        <p className="avatar-note">No male model installed, so the default avatar is shown. Add public/avatars/male.glb to change it.</p>
      )}
    </section>
  );
}

export default Avatar;
