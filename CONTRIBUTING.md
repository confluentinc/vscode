# Contributing to Confluent VS Code Extension

We welcome contributions to the Confluent VS Code Extension! This document provides guidance on setting up a development environment, coding standards, and the process for submitting contributions.

## Development Setup

### Prerequisites

- Node.js (version specified in `.nvmrc` or `package.json` engines)
- npm or yarn
- Docker (for local Kafka/Schema Registry testing)

### Initial Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/confluentinc/vscode.git
   cd vscode
   ```

2. Install dependencies:
   ```bash
   npm install
   ```
   This will automatically:
   - Install all npm dependencies
   - Set up Husky git hooks via the `prepare` script
   - Configure the pre-commit hook to run `npx gulp lint`

3. Build the extension:
   ```bash
   npx gulp build
   ```

### Git Hooks

The extension uses [Husky](https://typicode.github.io/husky/) to enforce code quality through
git hooks:

**Pre-commit Hook**: Automatically runs `npx gulp lint` before every commit to catch linting
issues early.

- **Location**: `.husky/pre-commit`
- **Behavior**: Commits are blocked if linting fails
- **Fix linting issues**: Run `npx gulp lint -f` to auto-fix most issues
- **Bypass** (not recommended): Use `git commit --no-verify` to skip the hook

If you need to update the hook command:
```bash
# The hook file uses modern Husky format (v9+)
# Just edit .husky/pre-commit directly - no shebang or sourcing needed
echo "npx gulp lint" > .husky/pre-commit
chmod +x .husky/pre-commit
```

## Coding Standards

- Follow the existing code style and conventions used in the project.
- Use `prettier` for code formatting. Run `npx prettier --write .` to format your code.
- Ensure your code is linted with `eslint`. Fix any linting errors before submitting your contribution.

## Testing

- Write unit tests for new features and bug fixes.
- Run existing tests to ensure your changes do not break any functionality.
- Use `npm test` to run the test suite.

## Submitting Contributions

1. Ensure your code is up-to-date with the base repository:
   ```bash
   git checkout main
   git pull upstream main
   ```

2. Create a new branch for your contribution:
   ```bash
   git checkout -b my-contribution-branch
   ```

3. Make your changes and commit them with a descriptive message:
   ```bash
   git commit -m "Description of my changes"
   ```

4. Push your branch to your forked repository:
   ```bash
   git push origin my-contribution-branch
   ```

5. Submit a pull request to the base repository's `main` branch.

## Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](CODE_OF_CONDUCT.md). By participating in this project, you agree to abide by its terms.

## License

By contributing to this project, you agree that your contributions will be licensed under the project's [LICENSE](LICENSE) file.

Thank you for considering contributing to the Confluent VS Code Extension! We appreciate your help in improving the extension for all users.