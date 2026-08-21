import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { SortableList, Sortable, DragHandle } from './Sortable';
import { sectionLabelCls } from './constants';
import { useRowIds } from '../../hooks/useRowIds';
import type { Doc, UpdateFn } from './types';

/**
 * Where the API answers. The path part of a url is the base path — it belongs here rather than
 * repeated across every entry under `paths`, and it is where the mock gateway reads it from.
 */
export function ServersEditor({ doc, update }: { doc: Doc; update: UpdateFn }) {
  const { t } = useTranslation();
  const servers: Doc[] = Array.isArray(doc.servers) ? doc.servers : [];

  const { ids, reorder: reorderIds } = useRowIds(servers.length, 'server');

  const mutate = (fn: (list: Doc[]) => void) =>
    update((d) => {
      d.servers = Array.isArray(d.servers) ? d.servers : [];
      fn(d.servers);
      // An empty `servers:` says exactly what no `servers:` says, and the canonical form of
      // "nothing declared" is the key being absent.
      if (d.servers.length === 0) delete d.servers;
    });

  const reorder = (activeId: string, overId: string) => {
    const moved = reorderIds(activeId, overId);
    if (moved) mutate((list) => list.splice(moved.to, 0, list.splice(moved.from, 1)[0]));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className={sectionLabelCls}>{t('manageServers')}</h3>
        <Button size="sm" aria-label="add-server" onClick={() => mutate((list) => list.push({ url: '/' }))}>
          + {t('addServer')}
        </Button>
      </div>
      <SortableList ids={ids} onReorder={reorder}>
        {servers.map((server, i) => (
          <Sortable key={ids[i]} id={ids[i]!}>
            {({ setNodeRef, style, handleProps }) => (
              <div ref={setNodeRef} style={style} className="flex items-center gap-1.5">
                <DragHandle {...handleProps} />
                <Input
                  aria-label="server-url"
                  className="flex-1 font-mono text-[13px]"
                  placeholder={t('serverUrlPlaceholder')}
                  value={server?.url ?? ''}
                  onChange={(e) => mutate((list) => ((list[i] ??= {}).url = e.target.value))}
                />
                <Input
                  aria-label="server-description"
                  className="w-32 text-[13px]"
                  placeholder={t('fDescription')}
                  value={server?.description ?? ''}
                  onChange={(e) => mutate((list) => ((list[i] ??= {}).description = e.target.value || undefined))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="remove-server"
                  onClick={() => mutate((list) => list.splice(i, 1))}
                >
                  <X size={13} />
                </Button>
              </div>
            )}
          </Sortable>
        ))}
      </SortableList>
    </div>
  );
}
