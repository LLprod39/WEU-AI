/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './core_ui/templates/**/*.html',
    './core_ui/static/js/**/*.js',
    './servers/templates/**/*.html',
    './tasks/templates/**/*.html',
    './agent_hub/templates/**/*.html',
    './passwords/templates/**/*.html',
    './skills/templates/**/*.html',
  ],
  safelist: [
    'bg-bg-deep',
    'bg-bg-base',
    'bg-bg-surface',
    'bg-bg-elevated',
    'text-primary',
    'text-secondary',
    'text-tertiary',
    'text-muted',
    'bg-primary',
    'bg-primary/20',
    'bg-primary/30',
    'bg-primary/80',
    'border-primary',
    'border-primary/30',
    'border-primary/50',
    'shadow-glow-primary',
    'shadow-glow-primary-lg',
    'shadow-glow-success',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['DM Sans', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      colors: {
        bg: {
          deep: '#050507',
          base: '#09090b',
          surface: '#111113',
          elevated: '#18181b',
        },
        border: {
          subtle: 'rgba(255, 255, 255, 0.06)',
          DEFAULT: 'rgba(255, 255, 255, 0.1)',
          strong: 'rgba(255, 255, 255, 0.15)',
        },
        primary: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
          light: '#818cf8',
          dark: '#4338ca',
        },
        accent: '#06b6d4',
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(99, 102, 241, 0.3)',
        'glow-primary-lg': '0 0 40px rgba(99, 102, 241, 0.4)',
        'glow-success': '0 0 15px rgba(34, 197, 94, 0.4)',
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-out',
        'fade-in-up': 'fade-in-up 0.4s ease-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
      },
      spacing: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
        'safe-left': 'env(safe-area-inset-left)',
        'safe-right': 'env(safe-area-inset-right)',
      },
    },
  },
};
