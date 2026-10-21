import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Next 16 publishes native ESLint flat configs; FlatCompat cannot load them.
export default [
  {
    ignores: [".next/**", ".open-next/**", ".wrangler/**", "node_modules/**", "out/**", "dist/**", "coverage/**", "outputs/**", "next-env.d.ts"],
  },
  ...nextVitals,
  ...nextTs,
  {
    // Existing React 19 components use established state-sync effects and icon registry.
    // Retain legacy lint parity during the infrastructure upgrade, then refactor separately.
    rules: {
      "@next/next/no-img-element": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/static-components": "off",
    },
  },
];
