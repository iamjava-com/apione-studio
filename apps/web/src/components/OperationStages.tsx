import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, DEFAULT_STAGE, type Stage } from '../api';
import { useRevisit } from '../hooks/useRevisit';
import { useLatestOnly } from '../hooks/useLatestOnly';

/**
 * Every endpoint's workflow stage, for the two places that show it: a dot on each outline row and
 * the picker on the endpoint itself.
 *
 * Stages are server state keyed by `x-apione-id`, not part of the document — so unlike everything
 * else in the design canvas they are not edited into the file and saved. Setting one takes effect
 * immediately, which is why the map here is updated optimistically: the round trip would otherwise
 * show the old stage for as long as it takes.
 *
 * An endpoint typed into the outline and not yet saved has no id at all. There is nothing to key a
 * stage to until a save mints one, so it reads as the default and the picker is disabled.
 */
interface StageStore {
  stageOf: (opId: string | undefined) => Stage;
  setStage: (opId: string, stage: Stage) => Promise<void>;
  /** False while the first read is in flight, so nothing paints a default it is about to replace. */
  loaded: boolean;
}

const StagesContext = createContext<StageStore | null>(null);

export function OperationStagesProvider({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const [stages, setStages] = useState<Map<string, Stage>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const latest = useLatestOnly();
  const load = useCallback(() => {
    latest.read(
      'stages',
      api.operationStatuses(projectId),
      ({ statuses }) => {
        setStages(new Map(statuses.map((s) => [s.opId, s.stage])));
        setLoaded(true);
      },
      // No spec:read, or the project went away. An empty map reads as "everything is at the
      // default", which is what an unreachable stage list is worth.
      () => setLoaded(true),
    );
  }, [projectId, latest]);

  useEffect(() => {
    setLoaded(false);
    setStages(new Map()); // another project's stages are not this one's, not even for a frame
    load();
  }, [projectId, load]);

  // Nothing about a stage is in the document, so its version never moves and the file's own probe
  // says nothing about it — this has to ask on its own.
  useRevisit(load);

  const stageOf = useCallback((opId: string | undefined) => (opId && stages.get(opId)) || DEFAULT_STAGE, [stages]);

  const setStage = useCallback(
    async (opId: string, stage: Stage) => {
      const previous = stages.get(opId);
      setStages((m) => new Map(m).set(opId, stage));
      try {
        await latest.write('stages', () => api.setOperationStage(projectId, opId, stage));
      } catch (e) {
        setStages((m) => {
          const next = new Map(m);
          if (previous) next.set(opId, previous);
          else next.delete(opId);
          return next;
        });
        throw e;
      }
    },
    [projectId, stages, latest],
  );

  return <StagesContext.Provider value={{ stageOf, setStage, loaded }}>{children}</StagesContext.Provider>;
}

/** Null outside the provider — the Mock and Docs views render no stages. */
export function useStages(): StageStore | null {
  return useContext(StagesContext);
}
