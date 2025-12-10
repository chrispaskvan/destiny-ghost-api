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
