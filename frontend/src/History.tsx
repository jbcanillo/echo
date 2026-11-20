import { HistoryItem } from './db';
import { WaveformPlayer } from './WaveformPlayer';
import { formatDate, safeFilename } from './format';

interface HistoryProps {
  items: HistoryItem[];
  onReuse: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function History({ items, onReuse, onDelete, onClear }: HistoryProps) {
  if (items.length === 0) {
    return (
      <div className="empty-state">
        <p>Nothing generated yet.</p>
        <p>Every voice you generate is kept here on this device, so you can replay or download it later.</p>
      </div>
    );
  }

  return (
    <>
      <ul className="item-list">
        {items.map((item) => (
          <li key={item.id} className="item-card">
            <div className="item-head">
              <h3>{item.voiceName}</h3>
              <span className="meta">{formatDate(item.createdAt)}</span>
            </div>
            <p className="item-text">{item.text}</p>
            <WaveformPlayer blob={item.blob} title={item.voiceName} downloadName={`${safeFilename(item.voiceName)}_${item.createdAt}.wav`}>
              <button className="btn btn-primary btn-sm" onClick={() => onReuse(item)}>
                Reuse text
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => onDelete(item.id)} aria-label="Delete this generation">
                Delete
              </button>
            </WaveformPlayer>
          </li>
        ))}
      </ul>
      <button className="btn btn-ghost clear-all" onClick={onClear}>
        Clear history
      </button>
    </>
  );
}
