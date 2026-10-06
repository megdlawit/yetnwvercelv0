import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        display: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
        // The Indoor theme (landing page and the visitor map)
        inter: ['Indoor Inter', 'Noto Sans Ethiopic', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        bricolage: ['Bricolage Grotesque', 'Indoor Inter', 'Noto Sans Ethiopic', 'system-ui', 'sans-serif'],
        instrument: ['Instrument Serif', 'Georgia', 'serif'],
        news: ['Newsreader', 'Noto Sans Ethiopic', 'Georgia', 'Times New Roman', 'serif'],
        eth: ['Noto Sans Ethiopic', 'sans-serif'],
      },
      // Indoor theme breakpoints (order matters: later queries win)
      screens: {
        mx900: { raw: '(max-width: 900px)' },
        por: { raw: '(max-width: 900px) and (orientation: portrait)' },
        p440: { raw: '(max-width: 440px) and (orientation: portrait)' },
        ph700: { raw: '(max-height: 700px) and (orientation: portrait)' },
        p360: { raw: '(max-width: 360px) and (orientation: portrait)' },
        ph640: { raw: '(max-height: 640px) and (orientation: portrait)' },
        p380: { raw: '(max-width: 380px) and (orientation: portrait)' },
        ls: { raw: '(max-height: 560px) and (max-width: 1000px) and (orientation: landscape)' },
      },
      colors: {
        // The Indoor theme palette
        ink: '#0f3d26',
        sub: '#6b7168',
        paper: '#f8f6f1',
        pcard: '#fffdf8',
        lime: { DEFAULT: '#3fdc2c' },
        moss: '#2f6b2f',
        leaf: '#8fd06a',
        navblue: '#2f6bff',
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        nav: {
          current: "hsl(var(--nav-current))",
          destination: "hsl(var(--nav-destination))",
          path: "hsl(var(--nav-path))",
          room: "hsl(var(--nav-room))",
          "room-hover": "hsl(var(--nav-room-hover))",
          wall: "hsl(var(--nav-wall))",
          hallway: "hsl(var(--nav-hallway))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    // Indoor theme: state classes toggled imperatively by the 3D engine / animation loops
    ({ addVariant }: { addVariant: (name: string, def: string) => void }) => {
      for (const s of ['lit', 'hv', 'on', 'dim', 'fin', 'spin', 'drag', 'done', 'near', 'side', 'off', 'pause', 'next'])
        addVariant(`is-${s}`, `&.${s}`);
    },
  ],
} satisfies Config;
