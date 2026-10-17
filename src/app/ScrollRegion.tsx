"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Home scroll areas (workforce chart legend / columns, operational lists). Only when the content actually overflows
// does the area become a keyboard-focusable, labelled region (and show the optional hint), so nothing is reachable
// by mouse alone; without overflow it is a plain container (natural flow, e.g. on phones).
/** A scroll area that, when its content overflows, becomes a focusable labelled region and shows a hint. */
export function ScrollRegion({ className, label, hint, children }: { className: string; label: string; hint?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Only an axis the CSS lets scroll counts (phones keep overflow visible: natural flow, no focus stop).
    const check = () => {
      const cs = getComputedStyle(el);
      const scrolls = (o: string) => o === "auto" || o === "scroll";
      setOverflows((scrolls(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) || (scrolls(cs.overflowX) && el.scrollWidth > el.clientWidth + 1));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="home-scroll-wrap">
      <div ref={ref} className={className} {...(overflows ? { role: "region", "aria-label": label, tabIndex: 0 } : {})}>
        {children}
      </div>
      {overflows && hint && <p className="home-chart-scroll-hint">{hint}</p>}
    </div>
  );
}
