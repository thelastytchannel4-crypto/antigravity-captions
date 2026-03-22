/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        neonBlue: '#00f3ff',
        neonPurple: '#b800ff',
        neonCyan: '#00ffff',
        spaceDark: '#010514',
        glassBg: 'rgba(10, 15, 30, 0.4)',
        glassBorder: 'rgba(0, 243, 255, 0.2)',
      },
      fontFamily: {
        orbitron: ['Orbitron', 'sans-serif'],
        exo: ['Exo 2', 'sans-serif'],
      },
      animation: {
        'glow-pulse': 'glow 3s infinite alternate',
        'bob': 'bob 4s ease-in-out infinite',
      },
      keyframes: {
        glow: {
          '0%': { textShadow: '0 0 10px #00f3ff, 0 0 20px #00f3ff, 0 0 30px #b800ff' },
          '100%': { textShadow: '0 0 20px #00f3ff, 0 0 40px #00f3ff, 0 0 60px #b800ff' }
        },
        bob: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-20px)' }
        }
      }
    },
  },
  plugins: [],
}
