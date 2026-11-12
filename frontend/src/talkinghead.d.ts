// Minimal typings for the parts of TalkingHead / HeadAudio that Echo uses.
// Full API: https://github.com/met4citizen/TalkingHead and https://github.com/met4citizen/HeadAudio

declare module '@met4citizen/talkinghead' {
  export interface TalkingHeadOptions {
    ttsEndpoint?: string;
    lipsyncModules?: string[];
    lipsyncLang?: string;
    cameraView?: 'full' | 'mid' | 'upper' | 'head';
    cameraRotateEnable?: boolean;
    cameraPanEnable?: boolean;
    cameraZoomEnable?: boolean;
    modelPixelRatio?: number;
    modelFPS?: number;
    avatarMood?: string;
    update?: ((dt: number) => void) | null;
    [option: string]: unknown;
  }

  export interface AvatarOptions {
    url: string;
    body?: 'M' | 'F';
    avatarMood?: string;
    lipsyncLang?: string;
    baseline?: Record<string, number>;
    [option: string]: unknown;
  }

  export class TalkingHead {
    constructor(node: HTMLElement, opt?: TalkingHeadOptions);
    opt: TalkingHeadOptions;
    audioCtx: AudioContext;
    audioSpeechGainNode: GainNode;
    audioReverbNode: AudioNode;
    mtAvatar: Record<string, { newvalue: number; needsUpdate: boolean }>;
    isSpeaking: boolean;
    stateName: string;
    showAvatar(avatar: AvatarOptions, onprogress?: ((event: ProgressEvent) => void) | null): Promise<void>;
    setView(view: 'full' | 'mid' | 'upper' | 'head', opt?: Record<string, number>): void;
    setMood(mood: string): void;
    lookAtCamera(ms: number): void;
    speakWithHands(delay?: number, prob?: number): void;
    playGesture(name: string, dur?: number, mirror?: boolean, ms?: number): void;
    stopGesture(ms?: number): void;
    startListening(analyzer: AnalyserNode, opt?: Record<string, number>, onchange?: ((state: string, ms: number) => void) | null): void;
    stopListening(): void;
    start(): void;
    stop(): void;
    dispose(): void;
  }
}

declare module '@met4citizen/headaudio/dist/headaudio.min.mjs' {
  export class HeadAudio extends AudioWorkletNode {
    constructor(audioCtx: AudioContext, options?: { processorOptions?: object; parameterData?: Record<string, number> });
    loadModel(url: string, reset?: boolean): Promise<void>;
    update(dt: number): void;
    onvalue: ((key: string, value: number) => void) | null;
    onstarted: (() => void) | null;
    onended: (() => void) | null;
  }
}
