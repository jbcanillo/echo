import { useState } from 'react';
import { disableNotifications, enableNotifications, sendTestNotification, useNotifyState, type NotifyState } from './notify';
import { useInstall } from './install';

const CHIP: Record<NotifyState, string> = { on: 'On', off: 'Off', blocked: 'Blocked', unsupported: 'Not available' };

export function NotificationsCard() {
  const state = useNotifyState();
  const install = useInstall();
  const [message, setMessage] = useState('');

  const turnOn = async () => {
    setMessage('');
    const result = await enableNotifications();
    if (result === 'blocked') setMessage('The browser did not allow notifications for this site.');
  };

  let hint: string;
  if (state === 'unsupported') {
    hint = !window.isSecureContext
      ? 'Notifications need a secure connection. Open Echo over HTTPS (or on localhost).'
      : install.ios && !install.installed
        ? 'On iPhone and iPad, notifications work once Echo is added to your home screen (iOS 16.4 or later). Install it first, then open it from the home screen.'
        : 'This browser does not support notifications.';
  } else if (state === 'blocked') {
    hint = "Notifications are blocked for this site. Allow them in your browser's site settings, then come back here.";
  } else {
    hint = 'Get a notification when a voice is ready, or fails, while Echo is in another tab or window. Nothing is sent to any server.';
  }

  return (
    <section className="card" aria-labelledby="h-notify">
      <h2 id="h-notify">
        <span className="step">//</span> Notifications
      </h2>
      <div className="key-status">
        <span className={`chip ${state === 'on' ? 'chip-ok' : ''}`}>{CHIP[state]}</span>
      </div>
      <p className="hint">{hint}</p>
      {message && (
        <div className="status-message error" role="alert">
          {message}
        </div>
      )}
      {(state === 'off' || state === 'on') && (
        <div className="settings-actions">
          {state === 'off' ? (
            <button className="btn btn-primary btn-sm" onClick={turnOn}>
              Turn on
            </button>
          ) : (
            <>
              <button className="btn btn-secondary btn-sm" onClick={() => sendTestNotification()}>
                Send a test
              </button>
              <button className="btn btn-ghost btn-sm" onClick={disableNotifications}>
                Turn off
              </button>
            </>
          )}
        </div>
      )}
      {state === 'on' && (
        <p className="hint">If you do not see the test, check your system's Do Not Disturb or Focus mode.</p>
      )}
      <p className="hint">
        Echo can only notify you while the browser keeps it running. If your phone puts the browser to sleep, or you close it, you will not be notified.
      </p>
    </section>
  );
}
