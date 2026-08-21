import { useTranslation } from 'react-i18next';
import { STAGES, type Stage } from '../../api';

/**
 * How far along the workflow a stage sits, as a fraction of the dot that is filled in.
 *
 * The signal is the amount filled, not a colour: five hues carry no order — nobody reads teal as
 * "later than orange" — while a quarter, a half and a full circle need no legend. It also survives
 * colour blindness and a greyscale print, which a five-hue scale does not.
 */
const FILL = Object.fromEntries(STAGES.map((s, i) => [s, (i / (STAGES.length - 1)) * 100])) as Record<Stage, number>;

/**
 * Empty ring = nothing built yet; full brass = live. One colour throughout, so the eye reads the
 * arc rather than trying to rank hues.
 *
 * Brass, not the green that means "done" elsewhere: this dot sits directly against the method
 * badge, and a full green dot beside a green POST badge reads as one green thing. Brass belongs to
 * no method. `brand-solid` specifically — it is the one brass both themes share, so a quarter looks
 * like a quarter in either, and it is the brass meant to be a filled area rather than text.
 */
export const stageDotStyle = (stage: Stage): React.CSSProperties => ({
  background: `conic-gradient(var(--color-brand-solid) ${FILL[stage]}%, var(--color-border-strong) 0)`,
});

/** The i18n key for a stage's label. One place, so the dot, the picker and the export copy agree. */
export const stageKey = (stage: Stage): string => `stage_${stage}`;

/**
 * The workflow stage as a part-filled dot. It is the only thing on an outline row that is not in
 * the document, so it carries a title — an arc says how far along, never which stage.
 */
export function StageDot({ stage }: { stage: Stage }) {
  const { t } = useTranslation();
  return (
    <span
      title={t(stageKey(stage))}
      aria-label={`stage-${stage}`}
      className="size-2.5 shrink-0 rounded-full"
      style={stageDotStyle(stage)}
    />
  );
}
