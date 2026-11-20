import { SavedVoice } from './db';
import { WaveformPlayer } from './WaveformPlayer';
import { extensionFor, formatDate, formatSize, safeFilename } from './format';

interface LibraryProps {
  voices: SavedVoice[];
  /** Id of the voice currently selected as the sample, if any */
  activeId: string | null;
  onUse: (voice: SavedVoice) => void;
  onDelete: (id: string) => void;
}

export function Library({ voices, activeId, onUse, onDelete }: LibraryProps) {
  if (voices.length === 0) {
    return (
      <div className="empty-state">
        <p>No saved voices yet.</p>
        <p>Record or upload a sample, then choose “Save to library” to keep it here for next time.</p>
      </div>
    );
  }

  return (
    <ul className="item-list">
      {voices.map((voice) => (
        <li key={voice.id} className={`item-card${voice.id === activeId ? ' is-active' : ''}`}>
          <div className="item-head">
            <h3>{voice.name}</h3>
            <span className="meta">
              {formatDate(voice.createdAt)} · {formatSize(voice.blob.size)}
            </span>
          </div>
          <WaveformPlayer
            blob={voice.blob}
            title={voice.name}
            downloadName={`${safeFilename(voice.name)}.${extensionFor(voice.blob.type)}`}
          >
            <button className="btn btn-primary btn-sm" onClick={() => onUse(voice)} disabled={voice.id === activeId}>
              {voice.id === activeId ? 'In use' : 'Use voice'}
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => onDelete(voice.id)} aria-label={`Delete ${voice.name}`}>
              Delete
            </button>
          </WaveformPlayer>
        </li>
      ))}
    </ul>
  );
}
