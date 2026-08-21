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
        // PatentNest "Cobalt & Oxford" palette: white ground, cool grays,
        // one cobalt for actions + AI. Ramps below are aliases retuned in
        // place — changing values here re-skins every call site coherently.
        // 'ai-blue' is a LEGACY ALIAS of the lamp ramp: ~423 call sites across
        // the app still use bg-ai-blue-*/text-ai-blue-*; remapping the values
        // here re-skins them all coherently. New code should use 'lamp'.
        'ai-blue': {
          50: '#eef2fe',
          100: '#dbe6fd',
          200: '#bfd3fb',
          300: '#93b4f8',
          400: '#608df3',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
          800: '#1e3a8a',
          900: '#172554',
          950: '#101828',
        },
        // Lamp — the brand/AI accent, now cobalt (600 = #1d4ed8, the primary).
        lamp: {
          50: '#eef2fe',
          100: '#dbe6fd',
          200: '#bfd3fb',
          300: '#93b4f8',
          400: '#608df3',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
          800: '#1e3a8a',
          900: '#172554',
          950: '#101828',
        },
        // Brass — former gold "ceremony" ramp; under Cobalt & Oxford ceremony
        // goes quiet: cool grays (labels, seals, milestones read as muted ink).
        brass: {
          50: '#fcfcfd',
          100: '#f7f8fa',
          200: '#f2f4f7',
          300: '#e4e7ec',
          400: '#d0d5dd',
          500: '#98a2b3',
          600: '#667085',
          700: '#475467',
          800: '#344054',
          900: '#1d2939',
          950: '#101828',
        },
        // Wax — error red, cooled from sealing-wax to the verdict red family
        // (600 = #b91c1c, matching --destructive).
        wax: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#ef4444',
          500: '#dc2626',
          600: '#b91c1c',
          700: '#991b1b',
          800: '#7f1d1d',
          900: '#651616',
          950: '#450a0a',
        },
        // Paper — former warm neutrals, now the cool gray architecture
        // (100 = inset #f7f8fa, 300 = hairline #e4e7ec, 950 = oxford ink).
        paper: {
          50: '#fcfcfd',
          100: '#f7f8fa',
          200: '#f2f4f7',
          300: '#e4e7ec',
          400: '#d0d5dd',
          500: '#98a2b3',
          600: '#667085',
          700: '#475467',
          800: '#344054',
          900: '#1d2939',
          950: '#101828',
        },
        // Vellum — the warm paper ground for MARKETING surfaces only (the
        // homepage). The app keeps the cool 'paper' ramp above; this ramp
        // exists so the landing page reads as a document rather than a
        // dashboard. 200 is the ground, 400 draws sheet rules, 800 is the
        // graphite used for patent-figure line work, 900 is the ink.
        vellum: {
          50: '#fdfdfc',
          100: '#faf9f7',
          200: '#f6f5f2',
          300: '#eceae4',
          400: '#d8d5ce',
          500: '#a8a49b',
          600: '#6b6c66',
          700: '#55585d',
          800: '#3d4148',
          900: '#14161a',
        },
        // Semantic inks for the marketing figures. Cobalt (lamp-600) is what
        // PatentNest adds; these three are the other three voices — the
        // examiner, a verified result, and a weakening one.
        ink: {
          examiner: '#b91c1c',
          verified: '#096c45',
          weakening: '#b45309',
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
        // Cobalt & Oxford retires the serif from UI: font-serif call sites
        // (27 files) fall back to the sans stack so no page keeps Cormorant.
        serif: ['var(--font-inter)', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

