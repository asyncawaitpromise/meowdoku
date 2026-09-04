/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('daisyui'),
  ],
  daisyui: {
    themes: [
      // Keep the full built-in set (Settings.tsx lets users pick any of these)
      'light', 'dark', 'cupcake', 'bumblebee', 'emerald', 'corporate',
      'synthwave', 'retro', 'cyberpunk', 'valentine', 'halloween', 'garden',
      'forest', 'aqua', 'lofi', 'pastel', 'fantasy', 'wireframe', 'black',
      'luxury', 'dracula', 'cmyk', 'autumn', 'business', 'acid', 'lemonade',
      'night', 'coffee', 'winter', 'dim', 'nord', 'sunset',
      // Custom warm cream/brown theme matching the app's original board look
      {
        meowdoku: {
          'color-scheme': 'light',
          primary: '#5a2828',
          'primary-content': '#fffaf5',
          secondary: '#7a4545',
          'secondary-content': '#fffaf5',
          accent: '#d4a830',
          'accent-content': '#3a2a10',
          neutral: '#5a2828',
          'neutral-content': '#fffaf5',
          'base-100': '#f0e8e0',
          'base-200': '#fbf7f1',
          'base-300': '#e2d5c6',
          'base-content': '#5a2828',
          info: '#7a90b8',
          'info-content': '#f6f8fb',
          success: '#3a8a50',
          'success-content': '#eaf5ec',
          warning: '#d4a830',
          'warning-content': '#3a2a10',
          error: '#b03030',
          'error-content': '#fff0f0',
        },
      },
    ],
  },
}
