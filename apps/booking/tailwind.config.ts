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
        // Branding/theme comes from CSS variables at runtime (lib/theme.ts embed override +
        // /config branding); these fallbacks let the widget render before either loads.
        brand: {
          primary: 'var(--haip-primary, #06bdb4)',
          accent: 'var(--haip-accent, #f2641b)',
          'on-primary': 'var(--haip-on-primary, #ffffff)',
          surface: 'var(--haip-surface, #ffffff)',
        },
      },
      borderRadius: {
        brand: 'var(--haip-radius, 0.375rem)',
      },
      fontFamily: {
        // The widget's font is driven by --haip-font on .haip-booking; this keeps `font-sans`
        // consistent for any explicit uses.
        sans: ['var(--haip-font)', 'Montserrat', 'Arial', 'Helvetica', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
