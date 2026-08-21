import type { SVGProps } from 'react';

/** The brand logo. Paints with `currentColor`; size it via `className` (defaults to 1em square). */
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {/* A 3×3 grid of 6.67 cells cut in half diagonally; only the outer corners round. */}
      <path d="M4.4 2H19.6A2.4 2.4 0 0 1 22 4.4V19.6A2.4 2.4 0 0 1 19.6 22H15.33V15.33H8.67V8.67H2V4.4A2.4 2.4 0 0 1 4.4 2Z" />
    </svg>
  );
}
