import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { BI } from './chartTheme';

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  className?: string;
}

/** Compact trend ribbon for KPI cards. */
export default function Sparkline({
  data,
  color = BI.teal,
  height = 36,
  className,
}: SparklineProps) {
  if (!data.length) return null;
  const chartData = data.map((v, i) => ({ i, v }));
  const id = `spark-${color.replace('#', '')}`;

  return (
    <div className={className} style={{ height }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.75}
            fill={`url(#${id})`}
            isAnimationActive
            animationDuration={600}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
