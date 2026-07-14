/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        wa: {
          green: '#00a884',
          greenDark: '#005c4b',
          panel: '#111b21',
          header: '#202c33',
          dark: '#0b141a',
          bubbleIn: '#202c33',
          bubbleOut: '#005c4b',
          hover: '#2a3942',
          border: '#222d34',
          text: '#e9edef',
          muted: '#8696a0',
          search: '#202c33',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
