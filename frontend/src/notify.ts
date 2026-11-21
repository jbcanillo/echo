import { useSyncExternalStore } from 'react';

// Local notifications for long jobs: shown through the service worker when the app is in the background.
// Nothing here talks to a push server, so it works while the page is alive (another tab, a minimised window),
// not after the browser has closed or frozen it.

const KEY = 'echo.notify';
const BASE = import.meta.env.BASE_URL;

export type NotifyState = 'unsupported' | 'blocked' | 'on' | 'off';

export const notificationsSupported = () => 'Notification' in window && window.isSecureContext;

const wanted = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

export function notifyState(): NotifyState {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && wanted() ? 'on' : 'off';
}

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

let watching = false;
function watchPermission() {
  // The user can change the permission in the browser's site settings at any time
  if (watching || !navigator.permissions?.query) return;
  watching = true;
  navigator.permissions
    .query({ name: 'notifications' as PermissionName })
    .then((status) => {
      status.onchange = emit;
    })
    .catch(() => undefined);
}

export function useNotifyState(): NotifyState {
  return useSyncExternalStore(
    (listener) => {
      watchPermission();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notifyState
  );
}

/** Ask for permission (must be called from a click) and turn notifications on if it is granted */
export async function enableNotifications(): Promise<NotifyState> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch {
      /* older browsers use a callback; the permission check below still works */
    }
  }
  if (Notification.permission === 'granted') {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* stays on for this session only */
    }
  }
  emit();
  return notifyState();
}

export function disableNotifications() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

const inBackground = () => document.visibilityState !== 'visible' || !document.hasFocus();

async function show(title: string, body: string, tag: string) {
  const options: NotificationOptions = { body, tag, icon: `${BASE}pwa-192x192.png`, badge: `${BASE}favicon.png`, data: { url: BASE } };
  // Android Chrome only allows notifications through a service worker registration
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    /* fall through to the page-level API */
  }
  try {
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    /* this browser can't show it */
  }
}

/** Tell the user something finished. Skipped when notifications are off or they are already looking at Echo. */
export async function notify(title: string, body: string, tag: string) {
  if (notifyState() !== 'on' || !inBackground()) return;
  await show(title, body, tag);
}

/** For the Settings page: shows regardless of focus so the user can check it works */
export async function sendTestNotification() {
  if (notifyState() !== 'on') return;
  await show('Echo notifications are on', 'You will see one like this when a voice is ready.', 'echo-test');
}
