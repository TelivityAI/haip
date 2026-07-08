/** Sentinel value for portfolio (all properties) mode in the property switcher. */
export const PORTFOLIO_MODE_ID = 'portfolio';

export interface PropertySummary {
  id: string;
  name: string;
  code: string;
  organizationId?: string | null;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  code: string;
}
