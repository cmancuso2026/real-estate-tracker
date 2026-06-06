import type { Config } from 'tailwindcss';

export default {
  // Dark mode is toggled by adding/removing `class="dark"` on <html>.
  darkMode: 'class',
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
