import type { Config } from 'tailwindcss';
import path from 'path';

const root = path.resolve(__dirname);

export default {
  // Scope every utility under `.haip-booking` so the widget cannot clobber the
  // styles of a host page it is embedded into. The standalone SPA also mounts
  // inside an element carrying this class, so the prefix is transparent there.
  important: '.haip-booking',
  content: [
    path.join(root, 'index.html'),
    path.join(root, 'src/**/*.{ts,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        // Branding comes from /config at runtime via CSS variables; these are
        // sensible fallbacks so the widget renders before config loads.
        brand: {
          primary: 'var(--haip-primary, #06bdb4)',
          accent: 'var(--haip-accent, #f2641b)',
        },
      },
      fontFamily: {
        sans: ['Montserrat', 'Arial', 'Helvetica', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
