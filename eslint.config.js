import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Downgrade a warn: `any` explícito es común en integraciones con Firebase/MP
      "@typescript-eslint/no-explicit-any": "warn",
      // Interfaces vacías son patrón válido en TypeScript para extension points
      "@typescript-eslint/no-empty-object-type": "warn",
      // Expresiones sin asignación son válidas en algunos patrones de React
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
  // tailwind.config.ts usa require() por compatibilidad con el ecosistema PostCSS
  {
    files: ["tailwind.config.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
