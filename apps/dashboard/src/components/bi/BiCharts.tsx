import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { BI, BI_SERIES, ROOM_STATUS_COLORS, chartTooltipStyle } from './chartTheme';

export function RoomStatusDonut({
  data,
  emptyLabel,
}: {
  data: { name: string; status: string; value: number }[];
  emptyLabel: string;
}) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-56 text-sm text-telivity-mid-grey">
        {emptyLabel}
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={58}
          outerRadius={92}
          dataKey="value"
          nameKey="name"
          paddingAngle={2}
          stroke="none"
        >
          {data.map((entry, i) => (
            <Cell key={i} fill={ROOM_STATUS_COLORS[entry.status] ?? BI.midGrey} />
          ))}
        </Pie>
        <Tooltip contentStyle={chartTooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function OccupancyTrendChart({
  data,
  emptyLabel,
  valueLabel,
}: {
  data: { date: string; occupancyPct: number }[];
  emptyLabel: string;
  valueLabel: string;
}) {
  if (!data.length) {
    return <p className="text-sm text-telivity-mid-grey py-16 text-center">{emptyLabel}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={BI.grid} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: BI.slate }} tickLine={false} axisLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: BI.slate }}
          tickLine={false}
          axisLine={false}
          width={36}
        />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v: number) => [`${v.toFixed(1)}%`, valueLabel]}
        />
        <Line
          type="monotone"
          dataKey="occupancyPct"
          stroke={BI.teal}
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: BI.teal }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RevenueMixBars({
  data,
  currencyFmt,
  emptyLabel,
}: {
  data: { name: string; amount: number }[];
  currencyFmt: (n: number) => string;
  emptyLabel: string;
}) {
  if (!data.length) {
    return <p className="text-sm text-telivity-mid-grey py-12 text-center">{emptyLabel}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={BI.grid} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: BI.slate }} tickLine={false} axisLine={false} />
        <YAxis
          type="category"
          dataKey="name"
          width={90}
          tick={{ fontSize: 11, fill: BI.slate }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v: number) => [currencyFmt(v), '']}
        />
        <Bar dataKey="amount" radius={[0, 6, 6, 0]} barSize={16}>
          {data.map((_, i) => (
            <Cell key={i} fill={BI_SERIES[i % BI_SERIES.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PaymentMethodBars({
  data,
  currencyFmt,
  emptyLabel,
}: {
  data: { method: string; amount: number }[];
  currencyFmt: (n: number) => string;
  emptyLabel: string;
}) {
  if (!data.length) {
    return <p className="text-sm text-telivity-mid-grey py-12 text-center">{emptyLabel}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={BI.grid} vertical={false} />
        <XAxis dataKey="method" tick={{ fontSize: 11, fill: BI.slate }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: BI.slate }} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v: number) => [currencyFmt(v), '']}
        />
        <Bar dataKey="amount" fill={BI.deepBlue} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PortfolioRevenueBars({
  data,
  currencyFmt,
  revenueLabel,
}: {
  data: { name: string; revenue: number }[];
  currencyFmt: (n: number) => string;
  revenueLabel: string;
}) {
  if (!data.length) return null;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={BI.grid} vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: BI.slate }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: BI.slate }} tickLine={false} axisLine={false} width={48} />
        <Tooltip
          contentStyle={chartTooltipStyle}
          formatter={(v: number) => [currencyFmt(v), revenueLabel]}
        />
        <Bar dataKey="revenue" fill={BI.teal} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PaceDualLineChart({
  data,
  emptyLabel,
  roomsLabel,
  bookingsLabel,
}: {
  data: { date: string; roomsOnBooks: number; newBookings: number }[];
  emptyLabel: string;
  roomsLabel: string;
  bookingsLabel: string;
}) {
  if (!data.length) {
    return <p className="text-sm text-telivity-mid-grey py-16 text-center">{emptyLabel}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={BI.grid} vertical={false} />
        <XAxis dataKey="date" tick={{ fontSize: 11, fill: BI.slate }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: BI.slate }} tickLine={false} axisLine={false} width={36} />
        <Tooltip contentStyle={chartTooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="roomsOnBooks"
          name={roomsLabel}
          stroke={BI.teal}
          strokeWidth={2.5}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="newBookings"
          name={bookingsLabel}
          stroke={BI.navy}
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
