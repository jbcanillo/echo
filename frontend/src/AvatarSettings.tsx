import { useCallback, useEffect, useRef, useState } from 'react';
import { checkAvatarFile, MAX_AVATAR_MB } from './avatarFile';
import { deleteCustomAvatar, getCustomAvatar, saveCustomAvatar, type CustomAvatar } from './db';

type Gender = 'F' | 'M';
const SLOTS: Array<{ gender: Gender; label: string }> = [
  { gender: 'F', label: 'Female' },
  { gender: 'M', label: 'Male' }
];

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

interface Props {
  /** Called after an avatar is saved or removed, so the avatar on the Synthesize page reloads */
  onChange: () => void;
}

export function AvatarSettings({ onChange }: Props) {
  const [custom, setCustom] = useState<Partial<Record<Gender, CustomAvatar>>>({});
  const [busy, setBusy] = useState<Gender | null>(null);
  const [notes, setNotes] = useState<Partial<Record<Gender, { kind: 'error' | 'warn' | 'success'; text: string }>>>({});
  const inputs = useRef<Partial<Record<Gender, HTMLInputElement | null>>>({});

  const load = useCallback(async () => {
    const entries = await Promise.all(SLOTS.map(async ({ gender }) => [gender, await getCustomAvatar(gender).catch(() => undefined)] as const));
    setCustom(Object.fromEntries(entries.filter(([, avatar]) => avatar)) as Partial<Record<Gender, CustomAvatar>>);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setNote = (gender: Gender, note?: { kind: 'error' | 'warn' | 'success'; text: string }) => setNotes((current) => ({ ...current, [gender]: note }));

  const upload = async (gender: Gender, file: File | undefined) => {
    if (!file) return;
    setBusy(gender);
    setNote(gender);
    try {
      const check = await checkAvatarFile(file);
      if (check.error) {
        setNote(gender, { kind: 'error', text: check.error });
        return;
      }
      await saveCustomAvatar({ gender, name: file.name, size: file.size, blob: file, createdAt: Date.now() });
      await load();
      onChange();
      setNote(gender, check.warnings.length ? { kind: 'warn', text: check.warnings.join(' ') } : { kind: 'success', text: 'Saved. It is now used for this avatar.' });
    } catch (err: any) {
      setNote(gender, { kind: 'error', text: `Could not save the avatar in this browser: ${err?.message || 'storage is unavailable'}` });
    } finally {
      setBusy(null);
      const input = inputs.current[gender];
      if (input) input.value = ''; // so choosing the same file again still triggers a change
    }
  };

  const reset = async (gender: Gender) => {
    setBusy(gender);
    try {
      await deleteCustomAvatar(gender);
      await load();
      onChange();
      setNote(gender, { kind: 'success', text: 'Back to the default avatar.' });
    } catch (err: any) {
      setNote(gender, { kind: 'error', text: err?.message || 'Could not remove the avatar.' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card" aria-labelledby="h-avatars">
      <h2 id="h-avatars">
        <span className="step">//</span> Avatars
      </h2>
      <p className="hint">
        Replace the built-in 3D avatars with your own. Files stay in this browser and are never uploaded. A model needs a Mixamo-compatible skeleton and ARKit / Oculus
        viseme blend shapes, up to {MAX_AVATAR_MB} MB. See the README for how to make and compress one.
      </p>

      <div className="avatar-guide">
        <a className="btn btn-primary btn-sm" href="https://avaturn.me" target="_blank" rel="noreferrer noopener">
          Make an avatar at avaturn.me
        </a>
        <details>
          <summary>How to make one with Avaturn (free)</summary>
          <ol>
            <li>
              Open{' '}
              <a href="https://avaturn.me" target="_blank" rel="noreferrer noopener">
                avaturn.me
              </a>{' '}
              and start a new avatar. It builds a realistic 3D avatar from your photos, and you may need to sign in.
            </li>
            <li>Follow its steps: add your photos, then choose the hair, clothes and look.</li>
            <li>
              If it asks for the avatar type, choose <b>T2</b>. A T2 avatar has separate eyes and a mouth that can move; a T1 avatar has a fixed face, so its mouth would not follow the
              voice.
            </li>
            <li>
              Export or download it as a <b>.glb</b> file (glTF 2.0).
            </li>
            <li>
              Come back here and press <b>Upload .glb</b> under Female or Male. The avatar appears in the avatar window straight away.
            </li>
            <li>If Echo warns that no lip-sync blend shapes were found, that export has no face animation. Export it again as T2, or try another avatar.</li>
          </ol>
          <p className="hint">
            Avaturn's screens change, so button names may differ. According to TalkingHead's documentation it is free for non-commercial use; check Avaturn's terms before using an avatar for
            anything else.
          </p>
        </details>
      </div>

      {SLOTS.map(({ gender, label }) => {
        const avatar = custom[gender];
        const note = notes[gender];
        return (
          <div className="avatar-slot" key={gender}>
            <div className="avatar-slot-head">
              <strong>{label}</strong>
              <span className={`chip ${avatar ? 'chip-ok' : ''}`}>{avatar ? 'Custom' : 'Default'}</span>
            </div>
            <p className="hint">{avatar ? `${avatar.name} · ${megabytes(avatar.size)}` : 'Using the built-in avatar.'}</p>
            {note && (
              <div className={`status-message ${note.kind === 'warn' ? 'warn' : note.kind}`} role={note.kind === 'error' ? 'alert' : 'status'}>
                {note.text}
              </div>
            )}
            <div className="settings-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => inputs.current[gender]?.click()} disabled={busy !== null}>
                {busy === gender ? 'Working…' : avatar ? 'Replace .glb' : 'Upload .glb'}
              </button>
              {avatar && (
                <button className="btn btn-ghost btn-sm" onClick={() => reset(gender)} disabled={busy !== null}>
                  Use default
                </button>
              )}
              <input
                ref={(el) => {
                  inputs.current[gender] = el;
                }}
                type="file"
                accept=".glb,model/gltf-binary"
                hidden
                aria-label={`Upload a ${label.toLowerCase()} avatar`}
                onChange={(e) => upload(gender, e.target.files?.[0])}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}
