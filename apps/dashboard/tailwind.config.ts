import type { Config } from 'tailwindcss';
import path from 'path';

const root = path.resolve(__dirname);

export default {
  content: [
    path.join(root, 'index.html'),
    path.join(root, 'src/**/*.{ts,tsx}'),
  ],
  theme: {
    extend: {
      colors: {
        telivity: {
          teal: '#06bdb4',
          'dark-teal': '#00a692',
          'light-teal': '#2cd1b9',
          orange: '#f2641b',
          'orange-lt': '#ff7d36',
          yellow: '#eec517',
          'deep-blue': '#016491',
          purple: '#5838c0',
          navy: '#23273d',
          slate: '#444863',
          'light-grey': '#f0f0f6',
          'mid-grey': '#bbbbc4',
        },
      },
      fontFamily: {
        sans: ['Montserrat', 'Arial', 'Helvetica', 'sans-serif'],
      },
      keyframes: {
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(100%)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        'pulse-skeleton': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '0.7' },
        },
        'bi-fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'slide-in': 'slide-in 0.2s ease-out',
        'skeleton': 'pulse-skeleton 1.5s ease-in-out infinite',
        'bi-enter': 'bi-fade-up 0.45s ease-out both',
      },
    },
  },
  plugins: [],
} satisfies Config;
