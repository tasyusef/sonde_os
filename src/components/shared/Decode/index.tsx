import { useEffect, useRef, useState } from "react";
import { decodeFrame, seedOf } from "@/lib/decode";
import { DECODE } from "@/lib/motion";
import { useHydratedReducedMotion } from "@/lib/motion-client";

/**
 * Text that decodes the first time it shows: letters and digits cycle
 * through glyphs and settle left to right over `DECODE.frames`. For a
 * page's own identifier (its hash, address or token ID) set in Departure
 * Mono; PARC's caps-only glyphs would garble it.
 *
 * Screen readers get the real text throughout, and once settled it is
 * plain text again, so select, copy and find work on it. Reduced motion
 * shows the text as is.
 */
export function Decode({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useHydratedReducedMotion();
  // The frame this text has reached; a new text starts again from 0.
  const [at, setAt] = useState({ text, frame: 0 });
  const frame = at.text === text ? at.frame : 0;
  const settling = !reduced && frame < DECODE.frames;

  // The clock starts once it is on screen; until then it holds frame 0.
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced) return;
    let timer = 0;
    const seen = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      seen.disconnect();
      let n = 0;
      const tick = () => {
        n++;
        setAt({ text, frame: n });
        if (n < DECODE.frames) timer = window.setTimeout(tick, 1000 / DECODE.fps);
      };
      timer = window.setTimeout(tick, 1000 / DECODE.fps);
    });
    seen.observe(el);
    return () => {
      seen.disconnect();
      clearTimeout(timer);
    };
  }, [text, reduced]);

  return (
    <span ref={ref}>
      {settling ? (
        <>
          <span className="sr-only">{text}</span>
          <span aria-hidden="true">{decodeFrame(text, frame, DECODE.frames, seedOf(text))}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}

export default Decode;
