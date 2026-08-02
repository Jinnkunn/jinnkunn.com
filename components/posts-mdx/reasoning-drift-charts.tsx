import type { ReactNode } from "react";

type BarDatum = {
  label: string;
  sublabel?: string;
  value: number;
  count?: string;
};

type Point = {
  x: number;
  y: number;
};

const WIDTH = 640;
const BAR_HEIGHT = 260;
const LINE_HEIGHT = 260;
const MARGIN = { top: 20, right: 18, bottom: 52, left: 44 };

function formatPct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function yScale(value: number, min: number, max: number, height: number) {
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  return MARGIN.top + (1 - (value - min) / (max - min)) * plotHeight;
}

function chartPath(points: Point[], yMin: number, yMax: number, height = LINE_HEIGHT) {
  if (points.length === 0) return "";
  const xMin = Math.min(...points.map((point) => point.x));
  const xMax = Math.max(...points.map((point) => point.x));
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const xFor = (x: number) =>
    MARGIN.left + (xMax === xMin ? 0.5 : (x - xMin) / (xMax - xMin)) * plotWidth;
  return points
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${xFor(point.x).toFixed(1)},${yScale(point.y, yMin, yMax, height).toFixed(1)}`;
    })
    .join(" ");
}

function ChartFigure({
  caption,
  children,
  className = "",
}: {
  caption: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <figure className={`mdx-chart ${className}`.trim()}>
      {children}
      <figcaption className="notion-caption notion-semantic-string mdx-chart__caption">
        {caption}
      </figcaption>
    </figure>
  );
}

function Grid({
  ticks,
  min,
  max,
  height,
}: {
  ticks: number[];
  min: number;
  max: number;
  height: number;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => {
        const y = yScale(tick, min, max, height);
        return (
          <g key={tick}>
            <line
              className="mdx-chart__grid"
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y}
              y2={y}
            />
            <text className="mdx-chart__tick" x={MARGIN.left - 12} y={y + 4} textAnchor="end">
              {tick.toFixed(tick < 1 ? 1 : 0)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Axis({ height }: { height: number }) {
  const y0 = height - MARGIN.bottom;
  return (
    <g aria-hidden="true">
      <line className="mdx-chart__axis" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y0} y2={y0} />
      <line className="mdx-chart__axis" x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={y0} />
    </g>
  );
}

function BarChart({
  title,
  data,
  max,
  ticks,
  className = "",
}: {
  title: string;
  data: BarDatum[];
  max: number;
  ticks: number[];
  className?: string;
}) {
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const gap = 18;
  const barWidth = (plotWidth - gap * (data.length - 1)) / data.length;
  const y0 = BAR_HEIGHT - MARGIN.bottom;

  return (
    <svg
      className={`mdx-chart__svg ${className}`.trim()}
      viewBox={`0 0 ${WIDTH} ${BAR_HEIGHT}`}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <Grid ticks={ticks} min={0} max={max} height={BAR_HEIGHT} />
      <Axis height={BAR_HEIGHT} />
      {data.map((datum, index) => {
        const x = MARGIN.left + index * (barWidth + gap);
        const y = yScale(datum.value, 0, max, BAR_HEIGHT);
        const height = Math.max(0, y0 - y);
        return (
          <g key={datum.label}>
            <rect
              className={`mdx-chart__bar mdx-chart__bar--${index + 1}`}
              x={x}
              y={y}
              width={barWidth}
              height={height}
              rx="4"
            />
            <text className="mdx-chart__value" x={x + barWidth / 2} y={y - 8} textAnchor="middle">
              {formatPct(datum.value)}
            </text>
            <text className="mdx-chart__label" x={x + barWidth / 2} y={y0 + 24} textAnchor="middle">
              {datum.label}
            </text>
            {datum.sublabel && (
              <text className="mdx-chart__sublabel" x={x + barWidth / 2} y={y0 + 42} textAnchor="middle">
                {datum.sublabel}
              </text>
            )}
            {datum.count && (
              <text className="mdx-chart__sublabel" x={x + barWidth / 2} y={y0 + 42} textAnchor="middle">
                {datum.count}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function ReasoningDriftBucketChart() {
  return (
    <ChartFigure caption="Figure 1. Accuracy falls sharply after the lowest-instability bucket; buckets move left to right from lower to higher S.">
      <BarChart
        title="Bucketed accuracy by peak instability strength"
        data={[
          { label: "B1", sublabel: "1.90-2.75", value: 0.267 },
          { label: "B2", sublabel: "2.75-2.98", value: 0.117 },
          { label: "B3", sublabel: "3.00-3.37", value: 0.083 },
          { label: "B4", sublabel: "3.37-3.77", value: 0.067 },
          { label: "B5", sublabel: "3.79-4.51", value: 0.083 },
        ]}
        max={0.3}
        ticks={[0, 0.1, 0.2, 0.3]}
      />
    </ChartFigure>
  );
}

export function ReasoningDriftEarlyWarningChart() {
  const points: Point[] = [
    { x: 1, y: 0.65 },
    { x: 4, y: 0.661 },
    { x: 8, y: 0.665 },
    { x: 12, y: 0.666 },
    { x: 20, y: 0.668 },
    { x: 24, y: 0.659 },
    { x: 32, y: 0.662 },
    { x: 50, y: 0.665 },
    { x: 64, y: 0.666 },
    { x: 75, y: 0.668 },
    { x: 86, y: 0.666 },
    { x: 96, y: 0.657 },
    { x: 112, y: 0.656 },
    { x: 128, y: 0.657 },
  ];
  return (
    <ChartFigure caption="Figure 2. Prefix-only instability is already above chance early, and additional context adds little separation in this run.">
      <svg
        className="mdx-chart__svg mdx-chart__svg--line"
        viewBox={`0 0 ${WIDTH} ${LINE_HEIGHT}`}
        role="img"
        aria-label="AUC by prefix length"
      >
        <title>AUC by prefix length</title>
        <Grid ticks={[0.5, 0.6, 0.7, 0.8]} min={0.5} max={0.8} height={LINE_HEIGHT} />
        <Axis height={LINE_HEIGHT} />
        <path className="mdx-chart__line" d={chartPath(points, 0.5, 0.8)} />
        {[10, 20, 50, 100, 128].map((x) => (
          <text
            key={x}
            className="mdx-chart__label"
            x={MARGIN.left + ((x - 1) / 127) * (WIDTH - MARGIN.left - MARGIN.right)}
            y={LINE_HEIGHT - MARGIN.bottom + 28}
            textAnchor="middle"
          >
            {x}
          </text>
        ))}
      </svg>
    </ChartFigure>
  );
}

export function ReasoningDriftTimingChart() {
  return (
    <ChartFigure caption="Figure 3. Earlier peaks are more often recoverable; late peaks are associated with much lower accuracy in the held-out trace audit.">
      <BarChart
        title="Accuracy by relative peak position"
        data={[
          { label: "Early", count: "n=57", value: 0.46 },
          { label: "Middle", count: "n=29", value: 0.35 },
          { label: "Late", count: "n=14", value: 0.14 },
        ]}
        max={0.5}
        ticks={[0, 0.1, 0.2, 0.3, 0.4, 0.5]}
        className="mdx-chart__svg--timing"
      />
    </ChartFigure>
  );
}

function TraceStrip({
  label,
  tone,
  points,
}: {
  label: string;
  tone: "correct" | "wrong";
  points: Point[];
}) {
  return (
    <div className="mdx-chart__trace">
      <div className="mdx-chart__trace-label">{label}</div>
      <svg
        className={`mdx-chart__trace-svg mdx-chart__trace-svg--${tone}`}
        viewBox={`0 0 ${WIDTH} 132`}
        role="img"
        aria-label={`${label} instability trace`}
      >
        <title>{label} instability trace</title>
        <Grid ticks={[0, 2, 4]} min={0} max={4.2} height={132} />
        <path className="mdx-chart__trace-line" d={chartPath(points, 0, 4.2, 132)} />
      </svg>
    </div>
  );
}

export function ReasoningDriftTraceExamples() {
  const correct: Point[] = [
    { x: 0, y: 1.5 },
    { x: 2, y: 3.7 },
    { x: 4, y: 4.0 },
    { x: 6, y: 0.8 },
    { x: 16, y: 0.7 },
    { x: 24, y: 2.2 },
    { x: 32, y: 0.8 },
    { x: 40, y: 2.7 },
    { x: 48, y: 0.8 },
    { x: 64, y: 0.7 },
    { x: 78, y: 2.4 },
    { x: 86, y: 0.8 },
    { x: 96, y: 1.8 },
    { x: 112, y: 0.7 },
    { x: 120, y: 0.8 },
  ];
  const wrong: Point[] = [
    { x: 0, y: 1.8 },
    { x: 2, y: 3.8 },
    { x: 8, y: 1.2 },
    { x: 16, y: 3.0 },
    { x: 24, y: 0.8 },
    { x: 34, y: 2.4 },
    { x: 46, y: 0.9 },
    { x: 58, y: 3.3 },
    { x: 68, y: 0.7 },
    { x: 76, y: 3.1 },
    { x: 82, y: 0.8 },
    { x: 88, y: 3.7 },
    { x: 92, y: 2.0 },
    { x: 100, y: 0.8 },
    { x: 110, y: 1.7 },
    { x: 120, y: 0.8 },
  ];
  return (
    <ChartFigure
      className="mdx-chart--traces"
      caption="Figure 4. The same signal can mark an early recoverable correction or a late destructive drift."
    >
      <div className="mdx-chart__trace-list">
        <TraceStrip label="Correct trace: early peak" tone="correct" points={correct} />
        <TraceStrip label="Wrong trace: late peak" tone="wrong" points={wrong} />
      </div>
    </ChartFigure>
  );
}

export function ReasoningDriftFailureModes() {
  const data = [
    { label: "Stable wrong", value: 16.7, count: 44, className: "stable" },
    { label: "Early collapse", value: 21.3, count: 56, className: "early" },
    { label: "Unstable wrong", value: 62.0, count: 163, className: "unstable" },
  ];
  return (
    <ChartFigure
      className="mdx-chart--partition"
      caption="Figure 5. Most wrong traces are dynamically unstable, but a meaningful minority are stable wrong answers."
    >
      <div className="mdx-chart__partition" role="img" aria-label="Wrong traces partitioned by failure mode">
        <div className="mdx-chart__partition-bar" aria-hidden="true">
          {data.map((datum) => (
            <span
              key={datum.label}
              className={`mdx-chart__partition-segment mdx-chart__partition-segment--${datum.className}`}
              style={{ flexBasis: `${datum.value}%` }}
            />
          ))}
        </div>
        <div className="mdx-chart__partition-legend">
          {data.map((datum) => (
            <div key={datum.label} className="mdx-chart__partition-row">
              <span
                className={`mdx-chart__partition-swatch mdx-chart__partition-segment--${datum.className}`}
                aria-hidden="true"
              />
              <span className="mdx-chart__partition-label">{datum.label}</span>
              <span className="mdx-chart__partition-value">
                {datum.count} ({datum.value.toFixed(1)}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </ChartFigure>
  );
}
