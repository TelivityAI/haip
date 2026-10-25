import axios from 'axios';

const origin = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export const checkInApiHttp = axios.create({
  baseURL: `${origin}/api/v1/guest-check-in`,
  headers: { 'Content-Type': 'application/json' },
});

export function setCheckInToken(token: string) {
  checkInApiHttp.defaults.headers.common['x-check-in-token'] = token;
}

export interface CheckInSession {
  property: {
    id: string;
    name: string;
    checkInTime: string;
    checkOutTime: string;
    timezone: string;
    currencyCode: string;
    guestRegistrationRequired: boolean;
    branding: {
      displayName?: string | null;
      primaryColor?: string | null;
      accentColor?: string | null;
    };
  };
  reservation: {
    id: string;
    confirmationNumber: string;
    status: string;
    arrivalDate: string;
    departureDate: string;
    nights: number;
    totalAmount: string;
    currencyCode: string;
    roomTypeName: string | null;
    roomNumber: string | null;
    registrationSubmittedAt: string | null;
    registrationSignedAt: string | null;
    registrationData: Record<string, unknown> | null;
    onlineCheckInCompletedAt: string | null;
    hasIdDocument: boolean;
  };
  guest: {
    firstName: string;
    lastName: string;
    email?: string | null;
    phone?: string | null;
    nationality?: string | null;
  } | null;
  config: {
    enabled: boolean;
    selfCheckInEnabled: boolean;
    checkInStartTime: string;
    autoAssignRoom: boolean;
    requireIdPhoto: boolean;
    requirePaymentWhenBalanceDue: boolean;
    accessMode: string;
    accessInstructions: string | null;
    walletEnabled: boolean;
  };
  folioBalance: number;
  registrationComplete: boolean;
  roomReady: boolean;
  canSelfCheckIn: { allowed: boolean; reason?: string };
  steps: {
    registration: boolean;
    id: boolean;
    payment: boolean;
    checkedIn: boolean;
  };
  payment?: {
    provider: string;
    clientMode: 'mock' | 'stripe' | 'redsys' | 'worldline' | 'unsupported';
    redsysConfigured?: boolean;
    worldlineConfigured?: boolean;
  };
  francePackEnabled?: boolean;
  stripePublishableKey?: string | null;
  privacyPolicyUrl?: string | null;
}

export interface UpsellOffer {
  campaignId: string;
  type: string;
  name: string;
  description: string;
  priceDelta: number;
  currencyCode: string;
  targetRoomTypeName?: string;
  alreadyAccepted?: boolean;
}

export interface RoomAccess {
  roomNumber: string | null;
  accessCode: string | null;
  accessMode: string;
  instructions: string | null;
  accessUnavailableReason?: string | null;
  provider: string | null;
  mobileKey: { type?: string; deepLink?: string; label?: string } | null;
  wallet: {
    walletEnabled?: boolean;
    apple?: { available: boolean; downloadPath?: string; preview: Record<string, string> };
    google?: { available: boolean; saveUrl?: string; preview: Record<string, string> };
    mobileKeyDeepLink?: string | null;
  };
  status: string;
}

function errorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join(', ');
    if (typeof data?.message === 'string') return data.message;
    return err.message;
  }
  return err instanceof Error ? err.message : 'Something went wrong';
}

export { errorMessage };

export const checkInApi = {
  session: async (): Promise<CheckInSession> => {
    const { data } = await checkInApiHttp.get<CheckInSession>('/session');
    return data;
  },
  preRegister: async (body: Record<string, unknown>): Promise<CheckInSession> => {
    const { data } = await checkInApiHttp.post<CheckInSession>('/pre-register', body);
    return data;
  },
  upsells: async (): Promise<{ offers: UpsellOffer[] }> => {
    const { data } = await checkInApiHttp.get<{ offers: UpsellOffer[] }>('/upsells');
    return data;
  },
  acceptUpsell: async (campaignId: string): Promise<CheckInSession> => {
    const { data } = await checkInApiHttp.post<CheckInSession>('/upsells/accept', { campaignId });
    return data;
  },
  pay: async (body: {
    amount: number;
    paymentMethodId?: string;
    gatewayPaymentToken?: string;
    gatewayProvider?: string;
    cardLastFour?: string;
    cardBrand?: string;
    returnUrl?: string;
  }): Promise<
    CheckInSession & {
      nextAction?: {
        type: 'redirect';
        url: string;
        method: 'POST' | 'GET';
        formFields?: Record<string, string>;
      };
    }
  > => {
    const { data } = await checkInApiHttp.post('/pay', body);
    return data;
  },
  worldlineTokenization: async (): Promise<{
    tokenizerScriptUrl: string;
    hostedTokenizationUrl: string;
    sri?: string;
  }> => {
    const { data } = await checkInApiHttp.post('/worldline-tokenization');
    return data;
  },
  selfCheckIn: async (): Promise<RoomAccess> => {
    const { data } = await checkInApiHttp.post<RoomAccess>('/self-check-in');
    return data;
  },
  access: async (): Promise<RoomAccess> => {
    const { data } = await checkInApiHttp.get<RoomAccess>('/access');
    return data;
  },
  requestLink: async (body: {
    propertyId: string;
    confirmationNumber: string;
    email: string;
  }): Promise<{ ok: boolean; message: string }> => {
    const { data } = await checkInApiHttp.post('/request-link', body);
    return data;
  },
};
