import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "node_modules/**",
      "public/assets/**",
      "archive/**",
      "portfolio_export/**",
      "**/* 2.*",
      ".claude/**",
    ],
  },
  {
    files: ["**/*.js", "**/*.mjs", "**/*.jsx"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-empty": "off",
      "no-undef": "error",
    },
  },
  {
    files: ["frontend/**/*.js", "frontend/**/*.jsx", "public/**/*.js"],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];
