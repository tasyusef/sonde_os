/** Build-time env Sonde reads. All optional; see `.env.example`. */
interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string;
  readonly VITE_LIVE_RELAY_URL?: string;
  readonly VITE_CF_BEACON_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
