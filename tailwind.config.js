/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Semantic tokens — defined as CSS variables in globals.css.
        // Prefer these over raw scale colors (bg-primary, not bg-indigo-600).
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // PatentNest "Banker's Green" palette.
        // 'ai-blue' is a LEGACY ALIAS of the lamp ramp: ~423 call sites across
        // the app still use bg-ai-blue-*/text-ai-blue-*; remapping the values
        // here re-skins them all coherently. New code should use 'lamp'.
        'ai-blue': {
          50: '#f2f6f1',
          100: '#e3ecdd',
          200: '#c8d9c0',
          300: '#a3bd9a',
          400: '#6f9a7c',
          500: '#45775c',
          600: '#2e5d47',
          700: '#254c3a',
          800: '#1e3d2f',
          900: '#172e24',
          950: '#0c1a13',
        },
        // Lamp green — the brand/AI accent (banker's-lamp glass).
        lamp: {
          50: '#f2f6f1',
          100: '#e3ecdd',
          200: '#c8d9c0',
          300: '#a3bd9a',
          400: '#6f9a7c',
          500: '#45775c',
          600: '#2e5d47',
          700: '#254c3a',
          800: '#1e3d2f',
          900: '#172e24',
          950: '#0c1a13',
        },
        // Brass — document ceremony only: section labels, seals, milestones.
        brass: {
          50: '#faf6ea',
          100: '#f1e8cf',
          200: '#e4d3a3',
          300: '#d3b970',
          400: '#bf9c45',
          500: '#a5822c',
          600: '#8a6a1f',
          700: '#6f541a',
          800: '#5c4516',
          900: '#4a3712',
          950: '#2a1f09',
        },
        // Sealing wax — warm red for errors and the spec-writing stage.
        wax: {
          50: '#f8ede9',
          100: '#f6e3dd',
          200: '#e6c3b8',
          300: '#d49a87',
          400: '#c06a4e',
          500: '#b04f33',
          600: '#a03b25',
          700: '#7c2d1a',
          800: '#5e2115',
          900: '#4a1b11',
          950: '#2b0f09',
        },
        // Paper — warm neutral surfaces (desk → page).
        paper: {
          50: '#fdfcfa',
          100: '#f7f5ef',
          200: '#f0eee6',
          300: '#e7e4d8',
          400: '#d8d4c2',
          500: '#c2bda6',
          600: '#a29c82',
          700: '#7f7a64',
          800: '#5c584a',
          900: '#3f3c33',
          950: '#26241e',
        },
        'ai-graphite': {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        // Keep existing for compatibility until full migration
        'gpt-gray': {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
        'gpt-blue': {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        'gpt-green': {
          500: '#10b981',
          600: '#059669',
        },
      },
      fontFamily: {
        // Matches the body font (Inter, loaded in layout.tsx) so font-sans === body text
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['var(--font-cormorant)', 'serif'],
      },
    },
  },
  plugins: [],
}

