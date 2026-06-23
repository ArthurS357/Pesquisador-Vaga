import type { Config } from "tailwindcss";

/**
 * Tailwind — Estratégia de Coexistência Pacífica.
 *
 * 100% aditivo sobre o CSS legado de `src/app/globals.css`. Nada é deletado.
 *
 * - `preflight: false` → o reset global do Tailwind NÃO roda, então o CSS
 *   legado (headings, botões, listas…) fica intocado. Só utilitários aditivos.
 * - `theme.extend.colors` → ponte para as CSS variables que já existem no
 *   globals.css. Os NOMES dos tokens são os pedidos (background/foreground/
 *   surface/accent/border/muted); os alvos `var(--…)` são os nomes reais
 *   presentes no `:root` (o globals.css usa `--bg`/`--text`/`--text-faint`,
 *   não `--background`/`--foreground`/`--muted`).
 */
const config: Config = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        background: "var(--bg)",
        foreground: "var(--text)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        accent: "var(--accent)",
        "accent-strong": "var(--accent-strong)",
        border: "var(--border)",
        "border-strong": "var(--border-strong)",
        muted: "var(--text-faint)",
        "muted-foreground": "var(--text-dim)",
        danger: "var(--danger)",
      },
    },
  },
  plugins: [],
};

export default config;
