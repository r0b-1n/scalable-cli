import { useId } from "react";
import { cn } from "../../lib/utils";

interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Colour by trend (last vs first) instead of the brand accent. */
  colorBySign?: boolean;
}

/**
 * Inline price trend. Plain SVG rather than a chart library: these render by
 * the dozen in tables and must stay cheap.
 */
export default function Sparkline({
  values,
  width = 88,
  height = 24,
  className,
  colorBySign = true,
}: SparklineProps) {
  const gradientId = useId();
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length < 2) {
    return <div style={{ width, height }} className={className} aria-hidden="true" />;
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  // A flat series would divide by zero; draw it down the middle instead.
  const span = max - min || 1;
  const stepX = width / (clean.length - 1);
  const points = clean.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * height;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const up = clean[clean.length - 1] >= clean[0];
  const stroke = colorBySign
    ? up
      ? "var(--sc-positive)"
      : "var(--sc-negative)"
    : "var(--sc-accent)";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("overflow-visible", className)}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
