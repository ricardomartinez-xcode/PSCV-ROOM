import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next 16 publishes native ESLint flat configs; FlatCompat cannot load them.
export default [
  {
    ignores: [".next/**", ".open-next/**", ".wrangler/**", "node_modules/**", "out/**", "dist/**", "coverage/**", "outputs/**", "next-env.d.ts"],
  },
  ...nextVitals,
  ...nextTs,
  { rules: { "@next/next/no-img-element": "off" } },
];
