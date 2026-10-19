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

/** Immersive flight: a camera path into the scene. */
export function FlightIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" class="icon">
      <path d="M4 18c3-1 5-4 7-7s4-5 8-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <path
        d="m15.5 4.2 3.6.8-1.2 3.4"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
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
