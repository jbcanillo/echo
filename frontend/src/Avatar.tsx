import { useEffect, useRef, useState } from 'react';
import { TalkingHead } from '@met4citizen/talkinghead';
import { HeadAudio } from '@met4citizen/headaudio/dist/headaudio.min.mjs';
import headWorkletUrl from '@met4citizen/headaudio/dist/headworklet.min.mjs?url';
import visemeModelUrl from '@met4citizen/headaudio/dist/model-en-mixed.bin?url';

// Replace this file (or point to another GLB) to change the avatar. The model needs a
// Mixamo-compatible rig plus ARKit and Oculus viseme blend shapes; see the TalkingHead README.
const AVATAR_URL = `${import.meta.env.BASE_URL}avatars/generic.glb`;
const AVATAR_OPTIONS = { body: 'F', avatarMood: 'neutral', lipsyncLang: 'en' } as const;

// HeadAudio needs ~100 ms to detect a viseme, so the audible speech is delayed to match the lips
const LIPSYNC_DELAY_SECONDS = 0.1;

// An <audio> element can only ever be wired into one Web Audio source node
const mediaSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

interface AvatarProps {
  /** Microphone stream while recording; the avatar listens to it */
  micStream: MediaStream | null;
  /** True while the voice is being generated */
  isThinking: boolean;
  /** The player for the generated voice; the avatar lip-syncs to whatever it plays */
  audioElement: HTMLAudioElement | null;
}

function Avatar({ micStream, isThinking, audioElement }: AvatarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [head, setHead] = useState<TalkingHead | null>(null);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

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
        await instance.showAvatar({ url: AVATAR_URL, ...AVATAR_OPTIONS }, (event) => {
          if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
        });

        const { audioCtx } = instance;
        await audioCtx.audioWorklet.addModule(headWorkletUrl);
        const headAudio = new HeadAudio(audioCtx, {
          parameterData: { vadGateActiveDb: -40, vadGateInactiveDb: -60 }
        });
        await headAudio.loadModel(visemeModelUrl);
        if (disposed) return;

        const head = instance;
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

  // Speaking: route the generated voice through the avatar so its lips follow the audio
  useEffect(() => {
    if (!head || !audioElement) return;
    let source = mediaSources.get(audioElement);
    if (!source) {
      source = head.audioCtx.createMediaElementSource(audioElement);
      mediaSources.set(audioElement, source);
    }
    source.connect(head.audioSpeechGainNode);

    const onPlay = () => {
      head.audioCtx.resume();
      head.isSpeaking = true;
      head.stateName = 'speaking';
      head.lookAtCamera(500);
      setIsSpeaking(true);
    };
    const onStop = () => {
      head.isSpeaking = false;
      head.stateName = 'idle';
      setIsSpeaking(false);
    };
    if (!audioElement.paused && !audioElement.ended) onPlay();
    audioElement.addEventListener('play', onPlay);
    audioElement.addEventListener('pause', onStop);
    audioElement.addEventListener('ended', onStop);
    return () => {
      audioElement.removeEventListener('play', onPlay);
      audioElement.removeEventListener('pause', onStop);
      audioElement.removeEventListener('ended', onStop);
      onStop();
      source.disconnect();
    };
  }, [head, audioElement]);

  let status = '';
  if (failed) status = 'Avatar unavailable on this device';
  else if (!head) status = `Loading avatar… ${progress}%`;
  else if (micStream) status = 'Listening…';
  else if (isThinking) status = 'Thinking…';
  else if (isSpeaking) status = 'Speaking…';

  return (
    <section className={`avatar${failed ? ' avatar-failed' : ''}`} aria-label="Avatar">
      <div ref={containerRef} className="avatar-stage" />
      <p className="avatar-status" role="status">{status}</p>
    </section>
  );
}

export default Avatar;
