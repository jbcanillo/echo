import { useState } from 'react';
import { dismissInstall, promptInstall, useInstall } from './install';

const ShareHint = () => (
  <>
    Tap the <b>Share</b> button, then <b>Add to Home Screen</b>.
  </>
);

/** A dismissible banner offering to install Echo, shown only while it isn't installed */
export function InstallBanner() {
  const install = useInstall();
  const [busy, setBusy] = useState(false);

  if (install.installed || install.dismissed || !(install.canPrompt || install.ios)) return null;

  const onInstall = async () => {
    setBusy(true);
    try {
      // Declining the browser's own dialog counts as "not now" so the banner doesn't nag
      if ((await promptInstall()) === 'dismissed') dismissInstall();
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="install-banner" role="region" aria-label="Install Echo">
      <img className="install-icon" src={`${import.meta.env.BASE_URL}pwa-192x192.png`} alt="" width={40} height={40} />
      <div className="install-text">
        <strong>Install Echo</strong>
        <span>{install.canPrompt ? 'Open it like an app from your home screen or desktop, with offline support and notifications.' : <ShareHint />}</span>
      </div>
      <div className="install-actions">
        {install.canPrompt && (
          <button className="btn btn-primary btn-sm" onClick={onInstall} disabled={busy}>
            Install now
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={dismissInstall}>
          {install.canPrompt ? 'Not now' : 'Got it'}
        </button>
      </div>
    </aside>
  );
}

/** The always-available version of the same thing, for the Settings page */
export function InstallCard() {
  const install = useInstall();
  const [busy, setBusy] = useState(false);

  let status: React.ReactNode;
  if (install.installed) {
    status = <span className="hint">You are running Echo as an installed app.</span>;
  } else if (install.canPrompt) {
    status = <span className="hint">Add Echo to your home screen or desktop. It opens in its own window and keeps working offline.</span>;
  } else if (install.ios) {
    status = (
      <span className="hint">
        <ShareHint />
      </span>
    );
  } else if (!install.secure) {
    status = <span className="hint">Installing needs a secure connection. Open Echo over HTTPS (or on localhost).</span>;
  } else {
    status = (
      <span className="hint">
        Your browser has not offered to install Echo. In Chrome or Edge, use the install icon in the address bar or the menu; in Safari on a Mac, File → Add to Dock.
      </span>
    );
  }

  return (
    <section className="card" aria-labelledby="h-install">
      <h2 id="h-install">
        <span className="step">//</span> Install app
      </h2>
      <div className="key-status">
        <span className={`chip ${install.installed ? 'chip-ok' : ''}`}>{install.installed ? 'Installed' : 'Not installed'}</span>
      </div>
      {status}
      {!install.installed && install.canPrompt && (
        <div className="settings-actions">
          <button
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await promptInstall();
              } finally {
                setBusy(false);
              }
            }}
          >
            Install now
          </button>
        </div>
      )}
    </section>
  );
}
