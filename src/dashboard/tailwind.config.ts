import type { Config } from 'tailwindcss';

export default {
  // Light mode only.
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Grade palette, reused by badges and charts.
        grade: {
          a: '#16a34a',
          b: '#2563eb',
          c: '#ca8a04',
          d: '#ea580c',
          f: '#dc2626',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
