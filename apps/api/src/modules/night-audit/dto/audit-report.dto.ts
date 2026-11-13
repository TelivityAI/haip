export interface AuditRunResult {
  alreadyRun: boolean;
  auditRun: {
    id: string;
    propertyId: string;
    businessDate: string;
    status: string;
    roomChargesPosted: string | null;
    taxChargesPosted: string | null;
    noShowsProcessed: string | null;
    summary: unknown;
    errors: Array<{ message: string; entity?: string }> | null;
    startedAt: Date;
    completedAt: Date | null;
  };
}

export interface TariffResult {
  totalRoom: string;
  totalTax: string;
  count: number;
  errors: Array<{ message: string; entity?: string }>;
}

export interface NoShowResult {
  count: number;
  reservationIds: string[];
  errors: Array<{ message: string; entity?: string }>;
}

export interface RevenueSummary {
  roomRevenue: number;
  taxRevenue: number;
  totalRevenue: number;
  roomsSold: number;
  occupancyRate: number;
  adr: number;
  revpar: number;
  mode?: 'manual' | 'unattended';
  overdueDeparturesCount?: number;
}
