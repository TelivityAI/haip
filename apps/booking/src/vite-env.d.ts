/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BOOKING_KEY?: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
