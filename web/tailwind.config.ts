import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surface scale — semantic tokens, not raw hex callsites.
        ink: {
          0: "var(--ink-0)",
          1: "var(--ink-1)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          4: "var(--ink-4)",
          5: "var(--ink-5)",
        },
        paper: {
          0: "var(--paper-0)",
          1: "var(--paper-1)",
          2: "var(--paper-2)",
          3: "var(--paper-3)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          fg: "var(--accent-fg)",
          soft: "var(--accent-soft)",
        },
        line: "var(--line)",
        positive: "var(--positive)",
        warn: "var(--warn)",
        bad: "var(--bad)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      fontFeatureSettings: {
        tnum: '"tnum"',
      },
      borderRadius: {
        xl: "14px",
        "2xl": "20px",
        "3xl": "28px",
      },
      boxShadow: {
        card: "0 1px 0 0 rgb(0 0 0 / 0.03), 0 8px 24px -12px rgb(0 0 0 / 0.12)",
        "card-dark":
          "0 1px 0 0 rgb(255 255 255 / 0.04), 0 8px 24px -12px rgb(0 0 0 / 0.6)",
        glow: "0 0 0 1px var(--accent-soft), 0 0 28px -4px var(--accent-soft)",
      },
      animation: {
        "fade-in": "fade-in 0.5s ease-out",
        "rise": "rise 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
} satisfies Config;
