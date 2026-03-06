module.exports = {
  printWidth: 100, // Matches max-len ESLint rule
  semi: true,
  singleQuote: true, // Common in airbnb style
  trailingComma: 'all',
  bracketSpacing: true,
  endOfLine: 'auto', // Handle linebreak-style automatically
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'avoid',
  // 'parser' removed from global scope — TypeScript is auto-detected for .ts/.tsx.
  // Keeping it globally caused JSON/YAML files to be parsed as TypeScript (bug).
  overrides: [
    { files: ['*.ts', '*.tsx'], options: { parser: 'typescript' } },
    { files: ['*.json'], options: { parser: 'json' } },
    { files: ['*.yml', '*.yaml'], options: { parser: 'yaml' } },
  ],
};
