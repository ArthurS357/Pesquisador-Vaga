/**
 * PostCSS — pipeline do Tailwind v3. `.mjs` (ESM) por o projeto ser ESM-first
 * (Next 16 / Turbopack). postcss travado em 8.5.15 via overrides.
 */
const config = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};

export default config;
