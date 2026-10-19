// Text that does not fit scrolls like a ticker: it rests at the start for a moment, then moves left at a constant
// speed, past its end and on until the copy that follows it is exactly where the text started; then it rests
// again and repeats. The left fade only appears while the text is moving, so a resting name is never cut.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import './marquee.css';

/** Scrolling speed (CSS px per second). */
const SPEED = 18;
const PAUSE_MS = 1000;
/** Width of the left fade while moving (CSS px), see marquee.css. */
const FADE_PX = 10;
/** The fade appears / disappears over this distance of movement at the start and at the end of a cycle. */
const FADE_DISTANCE_PX = 6;

interface Props {
  readonly text: string;
  readonly class?: string;
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function Marquee({ text, class: className }: Props) {
  const outer = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const first = useRef<HTMLSpanElement>(null);
  const copy = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  // does the text fit?
  useLayoutEffect(() => {
    const o = outer.current;
    const f = first.current;
    if (!o || !f) return;
    const measure = () => {
      setOverflowing(f.getBoundingClientRect().width > o.clientWidth + 0.5);
    };
    measure();
    // measured on the next frame: re-rendering inside the observer callback would chain resize notifications
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(o);
    observer.observe(f);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [text]);

  // the ticker (Web Animations: the timing depends on the measured widths)
  useLayoutEffect(() => {
    const o = outer.current;
    const t = track.current;
    const c = copy.current;
    if (!overflowing || !o || !t || !c || reducedMotion()) return;
    // exact (sub-pixel) distance to the copy: at the end of the move the copy sits where the text started
    const loop = c.getBoundingClientRect().left - t.getBoundingClientRect().left;
    const moveMs = (loop / SPEED) * 1000;
    const total = PAUSE_MS + moveMs;
    const at = (ms: number) => ms / total;
    const fadeMs = (FADE_DISTANCE_PX / SPEED) * 1000;
    const slide = t.animate(
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: at(PAUSE_MS) },
        { transform: `translateX(${-loop}px)`, offset: 1 },
      ],
      { duration: total, iterations: Infinity, easing: 'linear' },
    );
    const fade = o.animate(
      [
        { '--marquee-fade-left': '0px', offset: 0 },
        { '--marquee-fade-left': '0px', offset: at(PAUSE_MS) },
        { '--marquee-fade-left': `${FADE_PX}px`, offset: at(PAUSE_MS + fadeMs) },
        { '--marquee-fade-left': `${FADE_PX}px`, offset: at(total - fadeMs) },
        { '--marquee-fade-left': '0px', offset: 1 },
      ],
      { duration: total, iterations: Infinity, easing: 'linear' },
    );
    return () => {
      slide.cancel();
      fade.cancel();
    };
  }, [overflowing, text]);

  return (
    <span class={`marquee${overflowing ? ' overflowing' : ''}${className ? ` ${className}` : ''}`} ref={outer}>
      <span class="marquee-track" ref={track}>
        <span ref={first}>{text}</span>
        {overflowing && (
          <>
            <span class="marquee-gap" aria-hidden="true" />
            <span ref={copy} aria-hidden="true">
              {text}
            </span>
          </>
        )}
      </span>
    </span>
  );
}
