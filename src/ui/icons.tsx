// Small inline icons (no icon font, no external requests).

export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
      <path
        d="M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
      />
      <path
        d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.6-1.5L14.2 2.6h-4.4l-.3 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2.6 1.5l.3 2.5h4.4l.3-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3 1 2-3.4-2-1.5Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linejoin="round"
      />
    </svg>
  );
}

/** Immersive card: frames receding into depth, like entering the drawing. */
export function ImmersiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
      <rect x="2.5" y="4" width="19" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.7" />
      <rect
        x="6.5"
        y="7.5"
        width="11"
        height="9"
        rx="2"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        opacity="0.75"
      />
      <rect x="9.75" y="10.25" width="4.5" height="3.5" rx="1" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

export function CloudIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
      <path
        d="M7.5 18.5h9.2a4 4 0 0 0 .4-8A5.5 5.5 0 0 0 6.5 9.8a4.4 4.4 0 0 0 1 8.7Z"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linejoin="round"
      />
      <path d="M4 4l16 16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
  );
}

export function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
      <path
        d="m14.5 5-7 7 7 7"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
