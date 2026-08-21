import { useRef, useState } from 'react';
import {
  PointerSensor,
  KeyboardSensor,
  pointerWithin,
  rectIntersection,
  closestCenter,
  getFirstCollision,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { groupByTag } from '../lib/endpoint-outline';

type Doc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Op = {
  p: string;
  m: string;
  tag: string;
  summary: string;
  deprecated?: boolean;
  /** `x-apione-id`, absent until a save mints one — what a stage is keyed to. */
  opId?: string;
};
type DragGroups = { tag: string; ids: string[] }[]; // transient tag→op-id order during a drag

/** Group operations by their first tag. Declared tags always get a group here, even when empty,
 *  so you can drop ops into one and see defined-but-unused tags — that's design-canvas specific,
 *  hence the flag; the ordering itself is shared with the Mock navigator. */
function buildOpGroups(ops: Op[], tagOrder: string[]): { tag: string; ops: Op[] }[] {
  return groupByTag(ops, tagOrder, true);
}

const pathOf = (id: string): string => id.slice(id.indexOf(' ') + 1);

/** Split rows into runs of consecutive operations sharing a path. One key in `paths` holds the
 *  whole run, so the run is the unit the outline draws and dnd-kit sorts, keyed by its first id. */
export function pathRuns<T>(items: T[], idOf: (item: T) => string): T[][] {
  const runs: T[][] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (last && pathOf(idOf(last[0]!)) === pathOf(idOf(item))) last.push(item);
    else runs.push([item]);
  }
  return runs;
}

/**
 * The operation-outline drag/reorder/retag state machine, kept out of the render.
 *
 * dnd-kit's multi-container sortable pattern: a drag mutates a transient `dragState` (tag → op-id
 * order) so the target group opens a gap as you hover. The doc is written once, on drop.
 *
 * @param liveOps   every operation, in spec order (unfiltered) — the drag snapshot source.
 * @param shownOps  the operations the outline currently renders (after the filter).
 * @param tagOrder  top-level `tags:` order, for group ordering.
 * @param updateDoc commit path back to the spec file.
 */
export function useOpsDnd(
  liveOps: Op[],
  shownOps: Op[],
  tagOrder: string[],
  updateDoc: (mutate: (d: Doc) => void) => void,
) {
  const [draggingId, setDraggingId] = useState<string | null>(null); // op being dragged (for the overlay)
  const [dragState, setDragState] = useState<DragGroups | null>(null); // transient grouping while dragging
  const lastOverId = useRef<string | null>(null); // last resolved drop target, to hold on to
  const justMovedGroup = useRef(false); // set on a group change, released once the pointer moves on
  const freezeAt = useRef<{ x: number; y: number } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const grouped = liveOps.some((o) => o.tag !== '') || tagOrder.length > 0;
  const opGroups = buildOpGroups(shownOps, tagOrder);
  const opById = new Map(liveOps.map((o) => [`${o.m} ${o.p}`, o]));
  const draggingOp = draggingId ? opById.get(draggingId) : undefined;

  const containerOf = (gs: DragGroups, id: string): string | undefined =>
    id.startsWith('group:') ? id.slice('group:'.length) : gs.find((g) => g.ids.includes(id))?.tag;

  // The rows travelling with the dragged one. Methods of one path carrying different tags sit in
  // different groups, and each is its own unit there.
  const travelling = (() => {
    if (!draggingId || !dragState) return null;
    const path = pathOf(draggingId);
    const home = dragState.find((g) => g.ids.includes(draggingId));
    const count = home?.ids.filter((id) => pathOf(id) === path).length ?? 0;
    return count < 2 ? null : { path, count };
  })();

  // Dragging renders the transient dragState — unfiltered, so a row never vanishes mid-drag.
  const renderGroups: DragGroups =
    dragState ?? opGroups.map((g) => ({ tag: g.tag, ids: g.ops.map((o) => `${o.m} ${o.p}`) }));
  const renderOps = renderGroups.flatMap((g) =>
    g.ids.map((id) => opById.get(id)).filter((o): o is Op => o !== undefined),
  );

  // Pointer-based (not closest-corner): aiming at a group's last row never snaps to the next
  // group's header. The dragged item stays a candidate — hovering its own slot must resolve to
  // itself, or a drag can never be put back where it started.
  const collisionDetection: CollisionDetection = (args) => {
    // A group change moves every row below it, so the answer under a *stationary* pointer changes
    // — and can be the group just left, the two alternating until React gives up on the update
    // depth. Hold it until the pointer moves; a timer would freeze a pointer still travelling.
    const pointer = args.pointerCoordinates;
    if (justMovedGroup.current) {
      freezeAt.current ??= pointer;
      const from = freezeAt.current;
      if (pointer && from && Math.hypot(pointer.x - from.x, pointer.y - from.y) < 6 && lastOverId.current) {
        return [{ id: lastOverId.current }];
      }
      justMovedGroup.current = false;
      freezeAt.current = null;
    }
    const hits = pointerWithin(args);
    let primary = hits.length ? hits : rectIntersection(args);
    if (!primary.length) {
      // Nothing under the pointer: the nearest row in the *same* group answers. Unconfined, this
      // reaches across a group boundary and flips the drag between two groups on every re-measure.
      const home = (dragState ?? renderGroups).find((g) => g.ids.includes(String(args.active.id)))?.ids ?? [];
      primary = closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) => home.includes(String(c.id))),
      });
    }
    const overId = getFirstCollision(primary, 'id');
    if (overId == null) return [];
    lastOverId.current = String(overId);
    if (typeof overId === 'string' && overId.startsWith('group:')) {
      const ids = renderGroups.find((g) => `group:${g.tag}` === overId)?.ids ?? [];
      if (ids.length) {
        const inner = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((c) => ids.includes(String(c.id))),
        });
        if (inner.length) return inner;
      }
    }
    return [{ id: overId }];
  };

  // ── spec mutations ──────────────────────────────────────────────────────
  type Landing = { path: string; anchor: string; side: 'before' | 'after' };

  /**
   * Where the dragged path lands: beside the path it was dropped on, after it when the drag came
   * from above. Dropping on a method of the same path moves nothing — a path is one key in `paths`,
   * and inside it the methods follow the specification's field order, not the author's.
   */
  const landingOf = (ids: string[], activeId: string, overId: string): Landing | null => {
    const path = pathOf(activeId);
    const anchor = pathOf(overId);
    if (path === anchor) return null;
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    return { path, anchor, side: from >= 0 && to >= 0 && from < to ? 'after' : 'before' };
  };

  /**
   * Commit a drop: move the dragged path's key next to its new neighbour, every other key left
   * exactly where the file has it — the outline groups by tag, so rebuilding `paths` from what it
   * shows would reorder keys nobody touched. Only ops that changed group are re-tagged, which is
   * what keeps the extra tags on a multi-tag op.
   */
  const oldTagById = new Map(liveOps.map((o) => [`${o.m} ${o.p}`, o.tag]));
  const commitDrop = (gs: DragGroups, move: Landing | null) =>
    updateDoc((d) => {
      const keys = Object.keys(d.paths ?? {});
      if (move && keys.includes(move.path) && keys.includes(move.anchor)) {
        const rest = keys.filter((k) => k !== move.path);
        rest.splice(rest.indexOf(move.anchor) + (move.side === 'after' ? 1 : 0), 0, move.path);
        d.paths = Object.fromEntries(rest.map((k) => [k, d.paths[k]]));
      }
      const flat = gs.flatMap((g) => g.ids.map((id) => ({ id, tag: g.tag })));
      for (const { id, tag } of flat) {
        if (oldTagById.get(id) === tag) continue; // stayed put → leave its tags alone
        const o = d.paths?.[pathOf(id)]?.[id.slice(0, id.indexOf(' '))];
        if (!o) continue;
        const rest = Array.isArray(o.tags) ? o.tags.slice(1) : [];
        const next = tag ? [tag, ...rest] : rest;
        if (next.length) o.tags = next;
        else delete o.tags;
      }
    });

  const onDragStart = (e: DragStartEvent) => {
    lastOverId.current = null;
    justMovedGroup.current = false;
    freezeAt.current = null;
    setDraggingId(String(e.active.id));
    const groups = buildOpGroups(liveOps, tagOrder).map((g) => ({
      tag: g.tag,
      ids: g.ops.map((o) => `${o.m} ${o.p}`),
    }));
    // Untagged has no declaration to keep it alive, so it only exists while something is in it.
    // Without a standing drop target there is no way to drag the last op back out of a tag.
    if (!groups.some((g) => g.tag === '')) groups.push({ tag: '', ids: [] });
    setDragState(groups);
  };
  const onDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    setDragState((prev) => {
      if (!prev) return prev;
      const from = containerOf(prev, activeId);
      const to = containerOf(prev, overId);
      if (from == null || to == null || from === to) return prev;
      const next = prev.map((g) => ({ tag: g.tag, ids: g.ids.slice() }));
      const src = next.find((g) => g.tag === from)!;
      const dst = next.find((g) => g.tag === to)!;
      justMovedGroup.current = true;
      freezeAt.current = null;
      // The handle belongs to the path, so the whole path changes group — and therefore tag.
      const path = pathOf(activeId);
      const moving = src.ids.filter((id) => pathOf(id) === path);
      src.ids = src.ids.filter((id) => !moving.includes(id));
      const at = dst.ids.indexOf(overId);
      dst.ids.splice(at < 0 ? dst.ids.length : at, 0, ...moving);
      return next;
    });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    const state = dragState;
    setDraggingId(null);
    setDragState(null);
    if (!over || !state) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const to = containerOf(state, overId);
    if (to == null) {
      commitDrop(state, null);
      return;
    }
    // a group header drops at the end of its group
    const dst = state.find((g) => g.tag === to)!;
    const anchor = dst.ids.includes(overId) ? overId : (dst.ids[dst.ids.length - 1] ?? activeId);
    commitDrop(state, landingOf(dst.ids, activeId, anchor));
  };
  const onDragCancel = () => {
    setDraggingId(null);
    setDragState(null);
  };

  return {
    sensors,
    collisionDetection,
    grouped,
    renderGroups,
    /** Every rendered row in order, groups flattened — what the outline draws without headers. */
    renderOps,
    opById,
    draggingId,
    draggingOp,
    /** The path whose rows are travelling as one right now, or null while a single row moves. */
    travellingPath: travelling?.path ?? null,
    travellingCount: travelling?.count ?? 0,
    dragHandlers: { onDragStart, onDragOver, onDragEnd, onDragCancel },
  };
}
