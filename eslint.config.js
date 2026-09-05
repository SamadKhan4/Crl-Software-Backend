import globals from "globals";

export default [
  { ignores: ["node_modules", "coverage", "uploads"] },
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
];
