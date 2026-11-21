import { useSyncExternalStore } from 'react';

// Browsers fire `beforeinstallprompt` once, early, so it is captured when this module loads (main.tsx imports it
// first) and kept until the user chooses to install.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'echo.install.dismissedAt';
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000; // ask again after two weeks

export interface InstallState {
  /** Already running as an installed app */
  installed: boolean;
  /** The browser offered to install it, so a button can trigger the real prompt */
  canPrompt: boolean;
  /** iOS has no install prompt: it needs Share → Add to Home Screen */
  ios: boolean;
  /** Installing needs HTTPS (localhost counts) */
  secure: boolean;
  /** The user said "not now" recently */
  dismissed: boolean;
}

const displayMode = window.matchMedia('(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)');
const isStandalone = () => displayMode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function readDismissed(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return at > 0 && Date.now() - at < DISMISS_MS;
  } catch {
    return false;
  }
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = isStandalone();
let dismissed = readDismissed();
const listeners = new Set<() => void>();

const compute = (): InstallState => ({ installed, canPrompt: deferred !== null, ios: isIos(), secure: window.isSecureContext, dismissed });
let snapshot = compute();
const emit = () => {
  snapshot = compute(); // a new object only when something changed, as useSyncExternalStore requires
  listeners.forEach((listener) => listener());
};

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault(); // keep the event so our own button can show the prompt
  deferred = event as BeforeInstallPromptEvent;
  emit();
});
window.addEventListener('appinstalled', () => {
  installed = true;
  deferred = null;
  emit();
});
displayMode.addEventListener('change', () => {
  installed = isStandalone();
  emit();
});

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot
  );
}

/** Show the browser's install dialog. Must be called from a click. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const event = deferred;
  await event.prompt();
  const { outcome } = await event.userChoice;
  deferred = null; // the event can only be used once
  emit();
  return outcome;
}

export function dismissInstall() {
  dismissed = true;
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    /* it just comes back next visit */
  }
  emit();
}
