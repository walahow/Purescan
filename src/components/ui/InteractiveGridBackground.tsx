import { useCallback, useEffect, useRef, useState } from 'react';

interface TrailItem {
  id: string;
  x: number;
  y: number;
}

interface InteractiveGridBackgroundProps {
  width?: number;
  height?: number;
  maskSize?: string;
}

/**
 * HYDE-inspired 40x40 technical SVG grid background with radial vignette mask
 * and lightweight 60fps hover square trails on desktop pointers.
 */
export function InteractiveGridBackground({
  width = 40,
  height = 40,
  maskSize = 'min(92vw, 88vh, 1240px)',
}: InteractiveGridBackgroundProps) {
  const [trail, setTrail] = useState<TrailItem[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const timers = useRef<number[]>([]);

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) return;

      const gx = Math.floor(x / width) * width;
      const gy = Math.floor(y / height) * height;
      if (lastPos.current?.x === gx && lastPos.current?.y === gy) return;
      lastPos.current = { x: gx, y: gy };

      const id = `${gx}-${gy}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setTrail((prev) => [...prev.slice(-14), { id, x: gx, y: gy }]);

      const t = window.setTimeout(() => {
        setTrail((prev) => prev.filter((item) => item.id !== id));
      }, 1300);
      timers.current.push(t);
    },
    [width, height]
  );

  useEffect(() => {
    const isFinePointer = window.matchMedia?.('(pointer: fine)').matches;
    if (!isFinePointer) return;

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      for (const t of timers.current) clearTimeout(t);
      timers.current = [];
    };
  }, [handleMove]);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden" aria-hidden="true">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        className="absolute inset-0 h-full w-full"
        style={{
          WebkitMaskImage: `radial-gradient(${maskSize} circle at center, white, transparent)`,
          maskImage: `radial-gradient(${maskSize} circle at center, white, transparent)`,
        }}
      >
        <defs>
          <pattern id="hyde-scan-grid" width={width} height={height} patternUnits="userSpaceOnUse">
            <path
              d={`M ${width} 0 L 0 0 0 ${height}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1"
              className="text-zinc-900/[0.08]"
            />
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill="url(#hyde-scan-grid)" />

        {trail.map((item) => (
          <rect
            key={item.id}
            x={item.x}
            y={item.y}
            width={width}
            height={height}
            className="fill-zinc-900/[0.10] pointer-events-none"
            style={{
              animation: 'trail-elegant 1.3s cubic-bezier(0.22, 1, 0.36, 1) forwards',
              transformOrigin: `${item.x + width / 2}px ${item.y + height / 2}px`,
            }}
          />
        ))}
      </svg>
    </div>
  );
}
