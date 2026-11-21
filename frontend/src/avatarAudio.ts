// Every audio player in the app (the new voice, History, Library, the sample preview) registers its <audio> element
// here. The avatar connects to all of them and lip-syncs to whichever one is playing, so no element has to be
// passed down through the component tree.

interface Hooks {
  attach: (element: HTMLAudioElement) => void;
  detach: (element: HTMLAudioElement) => void;
}

const elements = new Set<HTMLAudioElement>();
let hooks: Hooks | null = null;

/** Called by a player when its <audio> element appears. Returns the function that unregisters it. */
export function registerAvatarAudio(element: HTMLAudioElement): () => void {
  elements.add(element);
  hooks?.attach(element);

  // One voice at a time: the avatar has a single mouth, so starting this one stops any other
  const onPlay = () => {
    for (const other of elements) if (other !== element && !other.paused) other.pause();
  };
  element.addEventListener('play', onPlay);

  return () => {
    element.removeEventListener('play', onPlay);
    elements.delete(element);
    hooks?.detach(element);
  };
}

/** Called by the avatar once it is ready: it is handed every player that exists now and every one added later */
export function connectAvatarAudio(next: Hooks): () => void {
  hooks = next;
  elements.forEach((element) => next.attach(element));
  return () => {
    if (hooks === next) hooks = null;
  };
}
