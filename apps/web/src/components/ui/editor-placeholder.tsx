import { Loader2 } from 'lucide-react';

/** What an editor pane shows while Monaco is on its way: the chunk, then the model. Absolutely
 * positioned — the parent is `relative`. */
export function EditorPlaceholder() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-bg text-faint">
      <Loader2 size={18} className="animate-spin" />
    </div>
  );
}
