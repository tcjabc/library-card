import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './print.css';

/** Shows a real-size printable page shrunk to the width available (screen preview only). */
export function ScaledPage({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const box = outer.current;
    const page = inner.current;
    if (!box || !page) return;
    const measure = () => {
      const s = Math.min(1, box.clientWidth / page.offsetWidth);
      setScale(s);
      setHeight(page.offsetHeight * s);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outer} className="scaled-page" style={{ height }}>
      <div ref={inner} className="scaled-page__page" style={{ transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}
