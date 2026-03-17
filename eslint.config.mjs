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
            sourceType: "module",
            globals: {
                console: "readonly",
                process: "readonly",
                Buffer: "readonly",
                __dirname: "readonly",
                __filename: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                setImmediate: "readonly",
                clearImmediate: "readonly",
                global: "readonly",
                module: "readonly",
                require: "readonly",
                exports: "writable",
                URL: "readonly",
                AbortController: "readonly",
                AbortSignal: "readonly",
                fetch: "readonly",
                Headers: "readonly",
                structuredClone: "readonly",
                Temporal: "readonly",
            },
        },
        plugins: {
            security,
        },
        rules: {
            "arrow-parens": ["error", "as-needed"],
            indent: [2, 4],
            "no-return-await": "off",
            "no-unused-vars": ["error", { "varsIgnorePattern": "^_" }],
        },
    },
];
