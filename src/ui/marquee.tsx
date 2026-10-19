// Text that does not fit scrolls like a ticker: it rests at the start, slides left until the end of the text is
// visible, pauses, then keeps going in the same direction until a copy of the text is back at the start.
// The left fade only appears while the text is moving, so a resting name is never cut.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import './marquee.css';

/** Scrolling speed (CSS px per second). */
const SPEED = 20;
const START_PAUSE_MS = 1800;
const END_PAUSE_MS = 1200;
/** Width of the fades at the edges (CSS px), see marquee.css. */
const FADE_PX = 10;
const FADE_MS = 200;

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
  const gap = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  // does the text fit?
  useLayoutEffect(() => {
    const o = outer.current;
    const f = first.current;
    if (!o || !f) return;
    const measure = () => {
      setOverflow(Math.max(0, Math.ceil(f.offsetWidth - o.clientWidth)));
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

  // the ticker animation (Web Animations: the keyframe offsets depend on the measured widths)
  useLayoutEffect(() => {
    const o = outer.current;
    const t = track.current;
    const f = first.current;
    const g = gap.current;
    if (overflow <= 0 || !o || !t || !f || !g || reducedMotion()) return;
    const reveal = overflow + FADE_PX; // the last letter ends clear of the right fade
    const loop = f.offsetWidth + g.offsetWidth; // the copy is then exactly where the text started
    const moveIn = (reveal / SPEED) * 1000;
    const moveOut = ((loop - reveal) / SPEED) * 1000;
    const total = START_PAUSE_MS + moveIn + END_PAUSE_MS + moveOut;
    const at = (ms: number) => ms / total;
    const slide = t.animate(
      [
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: at(START_PAUSE_MS), easing: 'ease-in-out' },
        { transform: `translateX(${-reveal}px)`, offset: at(START_PAUSE_MS + moveIn) },
        {
          transform: `translateX(${-reveal}px)`,
          offset: at(START_PAUSE_MS + moveIn + END_PAUSE_MS),
          easing: 'ease-in-out',
        },
        { transform: `translateX(${-loop}px)`, offset: 1 },
      ],
      { duration: total, iterations: Infinity },
    );
    const fade = o.animate(
      [
        { '--marquee-fade-left': '0px', offset: 0 },
        { '--marquee-fade-left': '0px', offset: at(START_PAUSE_MS) },
        { '--marquee-fade-left': `${FADE_PX}px`, offset: at(START_PAUSE_MS + FADE_MS) },
        { '--marquee-fade-left': `${FADE_PX}px`, offset: at(total - FADE_MS) },
        { '--marquee-fade-left': '0px', offset: 1 },
      ],
      { duration: total, iterations: Infinity },
    );
    return () => {
      slide.cancel();
      fade.cancel();
    };
  }, [overflow, text]);

  const scrolling = overflow > 0;
  return (
    <span class={`marquee${scrolling ? ' overflowing' : ''}${className ? ` ${className}` : ''}`} ref={outer}>
      <span class="marquee-track" ref={track}>
        <span ref={first}>{text}</span>
        {scrolling && (
          <>
            <span class="marquee-gap" ref={gap} aria-hidden="true" />
            <span aria-hidden="true">{text}</span>
          </>
        )}
      </span>
    </span>
  );
}
