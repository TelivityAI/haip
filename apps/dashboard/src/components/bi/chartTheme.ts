/** Shared Recharts styling for BI surfaces — Telivity tokens. */
export const BI = {
  teal: '#06bdb4',
  darkTeal: '#00a692',
  lightTeal: '#2cd1b9',
  orange: '#f2641b',
  yellow: '#eec517',
  deepBlue: '#016491',
  purple: '#5838c0',
  navy: '#23273d',
  slate: '#444863',
  midGrey: '#bbbbc4',
  grid: '#e8e8ef',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e8e8ef',
} as const;

export const BI_SERIES = [BI.teal, BI.deepBlue, BI.orange, BI.purple, BI.yellow, BI.darkTeal];

export const ROOM_STATUS_COLORS: Record<string, string> = {
  occupied: BI.teal,
  vacant_clean: BI.darkTeal,
  vacant_dirty: BI.orange,
  out_of_order: BI.yellow,
  out_of_service: BI.midGrey,
  clean: BI.darkTeal,
  inspected: BI.deepBlue,
  guest_ready: BI.lightTeal,
};

export const chartTooltipStyle = {
  backgroundColor: BI.tooltipBg,
  border: `1px solid ${BI.tooltipBorder}`,
  borderRadius: 10,
  fontSize: 12,
  boxShadow: '0 8px 24px rgba(35, 39, 61, 0.08)',
};
