import globals from "globals";
import js from "@eslint/js";
import security from "eslint-plugin-security";

export default [
    {
        ignores: ["coverage/"],    
    },
    js.configs.recommended,
    {
        languageOptions: {
            ecmaVersion: "latest",
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                sourceType: "module"
            },
        },
        plugins: {
            security,
        },
        rules: {
            "arrow-parens": ["error", "as-needed"],
            indent: [2, 4],
            "no-return-await": "off",
        },
    },
];
