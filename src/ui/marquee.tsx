// Text that does not fit scrolls back and forth (pausing at both ends) so the whole of it can be read.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import './marquee.css';

/** Scrolling speed (CSS px per second). */
const SPEED = 28;

interface Props {
  readonly text: string;
  readonly class?: string;
}

export function Marquee({ text, class: className }: Props) {
  const outer = useRef<HTMLSpanElement>(null);
  const inner = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const measure = () => {
      setOverflow(Math.max(0, Math.ceil(i.scrollWidth - o.clientWidth)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(o);
    observer.observe(i);
    return () => {
      observer.disconnect();
    };
  }, [text]);

  // the move takes 60% of the cycle; the rest are the pauses at both ends
  const duration = overflow > 0 ? overflow / SPEED / 0.6 : 0;
  return (
    <span class={`marquee${overflow > 0 ? ' overflowing' : ''}${className ? ` ${className}` : ''}`} ref={outer}>
      <span
        class="marquee-text"
        ref={inner}
        style={
          overflow > 0
            ? { '--marquee-shift': `-${overflow}px`, '--marquee-duration': `${duration.toFixed(2)}s` }
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}
