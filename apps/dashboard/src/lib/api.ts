import axios from 'axios';

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipErrorToast?: boolean;
    isSilentPoll?: boolean;
  }
}

export const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

/** Set the active property ID — added as query param to all requests */
export function setPropertyId(propertyId: string | null) {
  if (propertyId) {
    api.defaults.params = { ...api.defaults.params, propertyId };
  } else {
    const params = { ...api.defaults.params };
    delete params.propertyId;
    api.defaults.params = params;
  }
}
