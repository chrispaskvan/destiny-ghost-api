import security from "eslint-plugin-security";

export default [{
    languageOptions: {
        ecmaVersion: "latest",
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
}];