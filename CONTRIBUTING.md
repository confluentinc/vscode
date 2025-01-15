# Welcome to the Confluent for VS Code contributing guide

Thanks for your interest in contributing to this project! Our goal for the
[Confluent for VS Code project](https://github.com/confluentinc/vscode) is to help make it very easy
for developers to build stream processing applications using Confluent.

Anyone can contribute, and here are some ways to do so:

- [report problems](https://github.com/confluentinc/vscode/issues)
- reviewing and verifying [pull requests](https://github.com/confluentinc/vscode/pulls)
- creating [pull requests](https://github.com/confluentinc/vscode/pulls) with code changes to fix
  bugs, improve documentation, add/improve tests, and/or implement new features.

This document outlines the basic steps required to work with and contribute to this project.

Use the Table of contents icon in the top left corner of this document to get to a specific section
of this guide quickly.

## New contributor guide

To get an overview of the project, read the [README](./README.md) file. Here are some resources to
help you get started with open source contributions:

- [Finding ways to contribute to open source on GitHub](https://docs.github.com/en/get-started/exploring-projects-on-github/finding-ways-to-contribute-to-open-source-on-github)
- [Set up Git](https://docs.github.com/en/get-started/getting-started-with-git/set-up-git)
- [GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow)
- [Collaborating with pull requests](https://docs.github.com/en/github/collaborating-with-pull-requests)

## Issues

You can [report problems or comment on issues](https://github.com/confluentinc/vscode/issues)
without installing the tools, getting the code, or building the code. All you need is a GitHub
account.

### Create a new issue

If you spot a problem with the app, code, or docs
[search if an issue already exists](https://docs.github.com/en/github/searching-for-information-on-github/searching-on-github/searching-issues-and-pull-requests#search-by-the-title-body-or-comments).
If a related issue doesn't exist, you can open a new issue using a relevant
[issue form](https://github.com/confluentinc/vscode/issues/new/choose).

### Solve an issue

Scan through our [existing issues](https://github.com/github/confluentinc/vscode/issues) to find one
that interests you. You can narrow down the search using `labels` as filters. See
"[Label reference](https://docs.github.com/en/contributing/collaborating-on-github-docs/label-reference)"
for more information. As a general rule, you are welcome to open a PR with a fix unless that issue
is already assigned to someone else, or someone else has added a comment that they are working on
it.

## Install the tools

If you want to work with this project's codebase and maybe contribute to it, you will need to have
some development tools. This project uses the following software that you may already have:

- [Git](https://git-scm.com) — version 2.40.0 or later
- [Node.js](https://nodejs.org/en) — version 18.12.0 or later. It usually installs
  [NPM](https://www.npmjs.com) alongside
- [Visual Studio Code](https://code.visualstudio.com) — version 1.87.0 or later

See the links above for installation instructions on your platform. You can verify the versions you
have installed and that they are working.

    git --version

should be at least `2.40.0` or later,

    node --version

should be `18.12.0` or later, and

    code --version

should be `1.87.0` or later. See
[VS Code Command Line Interface Guide](https://code.visualstudio.com/docs/editor/command-line) for
more information about `code` command usage.

The project also uses these tools:

- [NVM](https://github.com/nvm-sh/nvm) — optional, Node.js version manager.
- [Gulp](https://gulpjs.com) — task automation tool. It is installed along with other Node.js
  dependencies, but you may want to install a global CLI package as well:

      npm install -g gulp

## Other services

The project also uses several services:

- [GitHub](https://github.com) — this project is on GitHub, so to contribute you'll need a GitHub
  account.
- [Semaphore CI/CD](https://semaphoreci.com/) — continuous integration and deployment service. You
  should not need an account.

## General development process

Bugs, feature requests, and suggested changes are tracked through the project's
[GitHub issues](https://github.com/confluentinc/vscode/issues).

All changes are made through [pull requests (PRs)](https://github.com/confluentinc/vscode/pulls).
Every PR's [Semaphore CI/CD build](https://semaphoreci.com/) must pass and code coverage (reported
as comments on the PR) should either improve or not appreciably change. The Confluent team will
review PRs and provide feedback; once the changes in the PR are acceptable, the team will merge the
PR onto the appropriate branch.

To create a PR, you must create a fork of this repository and set up your machine with the tools
needed for development. These steps are outlined below.

Most development occurs on the `main` branch. Therefore, most PRs will target the `main` branch, and
be merged to the `main` branch. We use [semantic versioning](https://semver.org/), so our version
numbers are of the form `v.MAJOR.MINOR.PATCH`, such as `v1.2.0`. We will release all major and minor
releases from the `main` branch.

If we need to patch a previously-released major or minor release, we will create a `v.MAJOR.MINOR.x`
branch (e.g., `v1.2.x`), and we create PRs against this branch for all fixes and changes. When the
patch is ready, we'll release the first `v.MAJOR.MINOR.1` patch version (e.g., `v1.2.1`). If we need
to make additional fixes, we'll continue to do so against this same branch and release subsequent
patch versions (e.g., `v1.2.2`, `v1.2.3`, etc).

This project's releases will be published to https://github.com/confluentinc/vscode/releases.

## Our codebase

    vscode/
    |- public/                   (Directory with public resources such as marketplace introduction page)
    |- resources/                (Directory with static resources for UI: images, icons, icon fonts)
    |- src/
    |  |- clients/               (Generated API clients based on OpenAPI specs)
    |  |- graphql/
    |  |  |- sidecar.graphql     (GraphQL definitions taken from ide-sidecar)
    |  |...
    |  |- extension.ts           (The extension's entry point)
    |- Gulpfile.js               (Automated tasks and workflows. Use `gulp --tasks` for brief help)
    |- .prettierrc               (Code formatting config, used by Prettier)
    |- eslint.config.js          (Linter config, used by ESLint)
    |- playwright.config.ts      (Functional testing config, used by Playwright Test)
    |- LICENSE.txt               (The license information for this repository)
    |- README.md                 (The readme file for this repository)
    |- package.json              (The extension's manifest & Node.js dependencies list)
    |- tsconfig.json             (TypeScript configuration file)

There are other top-level directories and files:

    vscode/
    |- .github/                  (Directory containing workflows, issue templates, pull request templates, and other files)
    |- .semaphore/               (Directory containing files used by Semaphore CI/CD)
    |- .versions/                (Directory containing files used by the build)
    |- .vscode/                  (Directory containing VS Code specific configurations for running the extension)
    |- mk-files/                 (Directory containing makefile include files)
    |- .gitignore                (File that defines the files and directories that are not be added to this repository)
    |- Makefile                  (The makefile for the project)
    |- service.yml               (File with the configuration for automated Confluent tooling for managing repositories)
    |- sonar-project.properties  (File with the configuration for code quality automation)
    |...

## Working with the codebase

This section outlines the one-time setup and installation of some tools. It then shows the basics of
building and testing the code

### One time setup

#### Fork this repository

Go to [this repository on GitHub](https://github.com/confluentinc/vscode) and click the "Fork"
button near the upper right corner of the page. Complete the form and click the "Create fork" button
to create your own https://github.com/YOUR-USERNAME/vscode repository. This is the repository to
which you will upload your proposed changes and create pull requests. See the
[GitHub documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo)
for details.

#### Clone your fork

To work locally on the code, you need to pull the code onto your machine. At a terminal, go to the
directory in which you want to place a local clone of this repository, and run the following
commands to use SSH authentication (recommended):

    git clone git@github.com:YOUR-USERNAME/vscode.git

or with HTTPS:

    git clone https://github.com/YOUR-USERNAME/vscode.git

This will create a `vscode` directory and pull the contents of your forked repository. Change into
that directory:

    cd vscode

#### Sync your repository with ours

If you intend to propose changes to our upstream repository, you should next configure your local
repository to be able to pull code from the project's _remote_ repository, called the _upstream_
repository.

Use the following command to see the current remotes for your fork:

    git remote -v

which will output something like:

    origin  git@github.com:YOUR-USERNAME/vscode.git (fetch)
    origin  git@github.com:YOUR-USERNAME/vscode.git (push)

or if you used HTTPS:

    origin  https://github.com/YOUR-USERNAME/vscode.git (fetch)
    origin  https://github.com/YOUR-USERNAME/vscode.git (push)

Then run the following command to add the project's repository as a remote called `upstream`:

    git remote add upstream git@github.com:confluentinc/vscode.git

or if you've used HTTPS:

    git remote add upstream https://github.com/confluentinc/vscode.git

To verify the new upstream repository you have specified for your fork, run this command again:

    git remote -v

You should see the URL for your fork as `origin`, and the URL for the project's upstream repository
as `upstream`. If you used SSH, this will look something like:

    origin  git@github.com:YOUR-USERNAME/vscode.git (fetch)
    origin  git@github.com:YOUR-USERNAME/vscode.git (push)
    upstream  git@github.com:confluentinc/vscode.git (fetch)
    upstream  git@github.com:confluentinc/vscode.git (push)

#### Get the latest upstream code

Once setup, you can periodically sync your fork with the upstream repository, using just a few Git
commands. The most common way is to keep your local `main` branch always in sync with the _upstream_
repository's `main` branch:

    git checkout main
    git fetch upstream
    git pull upstream main

You can create local branches from `main` and do your development there.

> [!NOTE]  
> You don't need to keep the `main` branch on your remote https://github.com/YOUR-USERNAME/vscode
> repository in sync, but you can if you want:
>
>     git push origin main

For more details and other options, see
"[Syncing a fork](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork)"
in GitHub's documentation.

#### Install dependencies

To install frontend-related dependencies, use NPM:

    npm ci

We recommend using `npm ci` over `npm install` so you'd get reproducible state of dependencies
defined by `package-lock.json`.

<!-- TODO sidecar related stuff? -->

### Building locally

Now that you have the source code and installed all the tools, you can build the project locally.
First check out the `main` branch:

    git checkout main

and pull the latest changes from the _project's repository_:

    git pull upstream main

Now you can compile the extension code:

    gulp build

When using VS Code, you can run the extension using Run and Debug tab. The project includes
necessary configs in `.vscode` folder to define what needs to be done for the extension to run in
debug mode.

To check the code against style conventions and potential bugs:

    gulp lint
    gulp check

To get a brief overview of existing automated tasks:

    gulp --tasks

### Cleaning

The build will create a lot of local files. You can clean up these generated files with:

    gulp clean

Cleaning is often useful to ensure that all generated files, JARs and executables are removed,
before rerunning the build and tests.

### Testing

This project uses unit tests and integration tests to verify functionality and identify regressions.

#### Unit tests

Unit tests usually located next to modules they cover. Look for `xxx.test.ts` pattern of files in
`src` folder. We use [Mocha](https://mochajs.org) for writing unit tests. To run the existing tests:

    gulp test

You can also specify a pattern (either for `describe` label or `it` labels) to lookup to run
specific tests:

    gulp test -t 'should register all commands'
    gulp test -t 'Extension manifest tests'

Unit tests should test small, isolated classes and functionality, and should not be unnecessarily
complex.

#### Functional tests

Functional tests are written for the content the extension display in Web views. These tests run
using [Playwright Test](https://playwright.dev) framework. The tests cover UI behavior of the Web
views content from perspective of the user interacting with them. To run the tests, use respective
task:

    gulp functional

#### Running the tests

To run unit tests:

    gulp test

To run functional tests:

    gulp functional

### Updating OpenAPI clients

We use [`openapi-generator-cli`](https://openapi-generator.tech/docs/usage) with the
[`typescript-fetch` generator](https://openapi-generator.tech/docs/generators/typescript-fetch/) to
create the client code from [OpenAPI specs](https://www.openapis.org/what-is-openapi).

The generated client code is used to help make requests to the services defined in the OpenAPI specs
without needing to manually write the request/response structures, middlewares, handlers, and more.

#### Generating the client code

To generate the client code, run the `apigen` task:

    gulp apigen

This task will generate the client code for all OpenAPI specs in the `src/clients` directory.

#### Adding a new OpenAPI spec

1. Copy the associated OpenAPI spec file(s) to the `src/clients` directory.
   - For requests handled by the sidecar\*, place them in the `src/clients/sidecar-openapi-specs`
     directory.
   - For other requests (like to the local Docker engine API), place them in the `src/clients`
     directory.
2. Update the `apigen` task's `clients` array in the
   [`Gulpfile.js`](https://github.com/confluentinc/vscode/blob/main/Gulpfile.js) to include the path
   of the new OpenAPI spec file(s) and their destination directory. For example:

```diff
const clients = [
  // existing clients
  ["src/clients/sidecar-openapi-specs/sidecar.openapi.yaml", "src/clients/sidecar"],
  ["src/clients/sidecar-openapi-specs/ce-kafka-rest.openapi.yaml", "src/clients/kafkaRest"],
  ["src/clients/sidecar-openapi-specs/schema-registry.openapi.yaml", "src/clients/schemaRegistryRest"],
  ["src/clients/sidecar-openapi-specs/scaffolding-service.openapi.yaml", "src/clients/scaffoldingService"],
- ["src/clients/docker.openapi.yaml", "src/clients/docker"]
+ ["src/clients/docker.openapi.yaml", "src/clients/docker"],
+ ["src/clients/sidecar-openapi-specs/new-service-openapi.yaml", "src/clients/newService"],
];
```

3. Run the `apigen` task:

```
   gulp apigen
```

\*_For sidecar-handled requests, update
[`SidecarHandle`](https://github.com/confluentinc/vscode/blob/main/src/sidecar/sidecarHandle.ts)
with any custom headers and/or other configurations._

#### Manual adjustments to OpenAPI specs

We occasionally need to make manual adjustments to OpenAPI specs before generating the client code.
To ensure these changes are not lost, we have a
[`src/clients/sidecar-openapi-specs/patches` directory](https://github.com/confluentinc/vscode/tree/main/src/clients/sidecar-openapi-specs/patches)
where we can store these changes as `.patch` files.

The `apigen` task will try (using a glob pattern to find all `.patch` files in the `patches`
directory) to apply these patches to the OpenAPI specs before generating the client code.

### Updating NOTICE files

<!-- prettier-ignore -->
> [!NOTE]
> The LICENSE.txt file contains the full text of the Apache License, Version 2.0. This file
> will never need to be updated.

A Semaphore CI/CD pipeline (See "Update third party notices PR" block in `.semaphore/semaphore.yml`)
automatically raises a Pull Request to update the `THIRD_PARTY_NOTICES.txt` and `NOTICE-vsix.txt`
files, on the following conditions (when a PR is merged into the `main` branch or a release branch,
e.g., `v1.2.x`):

- Any change to the `package.json` file (e.g., adding a new dependency, updating an existing one)
- Any change to the `NOTICE.txt` file
- Any change to the `scripts/notices/NOTICE-vsix_PREAMBLE.txt` file

The pipeline calls the `make update-third-party-notices-pr` target, which in turn calls the
following targets:

- `make generate-third-party-notices` to generate the `THIRD_PARTY_NOTICES.txt` file
- `make collect-notices-vsix` to generate the `NOTICE-vsix.txt` file: Appends `NOTICE.txt`,
  `scripts/notices/NOTICE-vsix_PREAMBLE.txt`, and `NOTICE*` files from all dependency NPM packages.

The PR raised must be summarily reviewed and merged by a maintainer. The PR title will be suffixed
with `[ci skip]` to avoid triggering the pipeline again.
