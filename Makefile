include ./mk-files/begin.mk
include ./mk-files/semver.mk
include ./mk-files/release.mk
include ./mk-files/semaphore.mk

# Install node_modules from package-lock.json
.PHONY: install-dependencies
install-dependencies:
	npm ci --prefer-offline --include=dev
	npx playwright install

# Install additional test dependencies to run VS Code testing in headless mode
# ref: https://code.visualstudio.com/api/working-with-extensions/continuous-integration#github-actions
# (just linux for now, but maybe eventually darwin)
.PHONY: install-test-dependencies
install-test-dependencies:
	@echo "Installing test dependencies for $(shell uname -s)"
	@if [ $$(uname -s) = "Linux" ]; then \
			sudo apt-get update; \
			sudo apt install -y libgbm1 libgtk-3-0 xvfb; \
	fi

.PHONY: setup-test-env
setup-test-env:
	@echo "Pulling automated-test-user credentials from Vault into .env file for testing"
	@echo "E2E_USERNAME=$(shell vault kv get -field=E2E_USERNAME v1/ci/kv/vscodeextension/testing)" > .env
	@echo "E2E_PASSWORD=$(shell vault kv get -field=E2E_PASSWORD v1/ci/kv/vscodeextension/testing)" >> .env
	@echo "E2E_SR_API_KEY=$(shell vault kv get -field=E2E_SR_API_KEY v1/ci/kv/vscodeextension/testing)" >> .env
	@echo "E2E_SR_API_SECRET=$(shell vault kv get -field=E2E_SR_API_SECRET v1/ci/kv/vscodeextension/testing)" >> .env
	@echo "E2E_SR_URL=$(shell vault kv get -field=E2E_SR_URL v1/ci/kv/vscodeextension/testing)" >> .env
	@echo "E2E_KAFKA_API_KEY=$(shell vault kv get -field=E2E_KAFKA_API_KEY v1/ci/kv/vscodeextension/testing)" >> .env
	@echo "E2E_KAFKA_API_SECRET=$(shell vault kv get -field=E2E_KAFKA_API_SECRET v1/ci/kv/vscodeextension/testing)" >> .env
	@echo "E2E_KAFKA_BOOTSTRAP_SERVERS=$(shell vault kv get -field=E2E_KAFKA_BOOTSTRAP_SERVERS v1/ci/kv/vscodeextension/testing)" >> .env

.PHONY: remove-test-env
remove-test-env:
	@echo "Removing .env file"
	@rm -f .env

# Run only unit (Mocha) tests (split for CI parallelization)
.PHONY: test-mocha
test-mocha: setup-test-env install-test-dependencies install-dependencies
	npx gulp build
	@if [ $$(uname -s) = "Linux" ]; then \
			xvfb-run -a npx gulp test; \
	elif [ $$(uname -s) = "Darwin" ]; then \
			if pgrep -x "Dock" > /dev/null; then \
					echo "GUI session is active."; \
					npx gulp test; \
			else \
					echo "No active GUI session. Aborting tests."; \
					exit 1; \
			fi \
	else \
			npx gulp test; \
	fi

# Run only webview (Playwright) tests (split for CI parallelization)
.PHONY: test-playwright-webviews
test-playwright-webviews: setup-test-env install-test-dependencies install-dependencies
	npx gulp build
	npx gulp functional

# Run E2E (Playwright) tests with optional test name
# Usage: make test-playwright-e2e (runs all tests)
# Usage: make test-playwright-e2e TEST_SUITE=@smoke
# Usage: make test-playwright-e2e TEST_SUITE=@regression
.PHONY: test-playwright-e2e
test-playwright-e2e: setup-test-env install-test-dependencies install-dependencies
	@if [ -n "$(TEST_SUITE)" ] && [ "$(TEST_SUITE)" != "" ]; then \
			TEST_SUITE_ARG="-t $(TEST_SUITE)"; \
	else \
			TEST_SUITE_ARG=""; \
	fi; \
	if [ $$(uname -s) = "Linux" ]; then \
			xvfb-run -a npx gulp e2e $$TEST_SUITE_ARG; \
	else \
			npx gulp e2e $$TEST_SUITE_ARG; \
	fi

# Validates bump based on current version (in package.json)
# and the version to be bumped to (in .versions/next.txt)
.PHONY: validate-bump
validate-bump:
	@node ./.semaphore/scripts/validateBump.script.js

.PHONY: bump-microversion
bump-microversion:
	export VERSION_OVERRIDE=$(shell cat ./.versions/next.txt) ;\
		export VERSION_POST=$(MICROVERSION_POST) ;\
		export BUMP=none ;\
		export SKIP_TAG_RELEASE=true ;\
		$(MAKE) release-ci

.PHONY: release-current-version
release-current-version:
	export VERSION_OVERRIDE=$(CURRENT_SEM_VERSION) ;\
	export BUMP=none ;\
	export CI_SKIP= ;\
	$(MAKE) release-ci

version_no_v = $(shell echo $(1) | sed 's,^v,,' )

.PHONY: upload-vsix-files-to-gh-releases
upload-vsix-files-to-gh-releases:
ifeq ($(LATEST_VERSION_NO_V), $(CURRENT_VERSION))
	for target in darwin-x64 darwin-arm64 linux-x64 linux-arm64 win32-x64; do \
		vsix_file=$$(find packaged-vsix-files -name "*$$target*.vsix"); \
		gh release upload $(LATEST_VERSION) $$vsix_file --clobber; \
	done;
else
	@echo "Skipping upload of VSIX files to GitHub release since the version checked out is not the latest version. Latest version is $(LATEST_VERSION_NO_V) and the version checked out is $(CURRENT_VERSION)"
	exit 1;
endif

IDE_SIDECAR_VERSION = $(shell cat .versions/ide-sidecar.txt)
IDE_SIDECAR_VERSION_NO_V := $(call version_no_v,$(IDE_SIDECAR_VERSION))

# Get the OS and architecture combination for the sidecar executable
SIDECAR_OS_ARCH ?= $(shell echo "$$(uname -s | tr '[:upper:]' '[:lower:]' | sed 's/darwin/macos/')-$$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')" )

# Check if we're targeting the Windows sidecar executable from a non-Windows agent
# (currently only done in `.semaphore/prerelease-multi-arch-packaging.yml` since the pipeline at
# `.semaphore/multi-arch-packaging.yml` uses `scripts/windows/download-sidecar-executable.ps1`)
IS_WINDOWS = $(shell echo "$(SIDECAR_OS_ARCH)" | grep -q 'windows' && echo true || echo false)
ifeq ($(IS_WINDOWS),true)
	EXECUTABLE_DOWNLOAD_PATH := bin/ide-sidecar-$(IDE_SIDECAR_VERSION_NO_V)-runner.exe
	export EXECUTABLE_PATH := ide-sidecar-$(IDE_SIDECAR_VERSION_NO_V)-runner-$(SIDECAR_OS_ARCH).exe
else
	EXECUTABLE_DOWNLOAD_PATH := bin/ide-sidecar-$(IDE_SIDECAR_VERSION_NO_V)-runner
	export EXECUTABLE_PATH := ide-sidecar-$(IDE_SIDECAR_VERSION_NO_V)-runner-$(SIDECAR_OS_ARCH)
endif

# Skip download if the executable already exists and is executable
SKIP_DOWNLOAD_EXECUTABLE := $(shell [ -x $(EXECUTABLE_DOWNLOAD_PATH) ] && echo true || echo false)

IDE_SIDECAR_REPO := confluentinc/ide-sidecar

# This target is meant for non-Windows platforms to download the sidecar executable
# For Windows, we use scripts/windows/download-sidecar-executable.ps1
.PHONY: download-sidecar-executable
download-sidecar-executable:
ifeq ($(SKIP_DOWNLOAD_EXECUTABLE),true)
	@echo "Skipping download of sidecar executable since it already exists at $(EXECUTABLE_DOWNLOAD_PATH)"
else
	mkdir -p bin && \
	echo "Using curl to download sidecar executable from GitHub release $(IDE_SIDECAR_VERSION): $(EXECUTABLE_DOWNLOAD_PATH)"; \
	curl --fail -L -o $(EXECUTABLE_DOWNLOAD_PATH) "https://github.com/$(IDE_SIDECAR_REPO)/releases/download/$(IDE_SIDECAR_VERSION)/$${EXECUTABLE_PATH}" && \
	chmod +x $(EXECUTABLE_DOWNLOAD_PATH) && \
	if [ $$(stat -f%z $(EXECUTABLE_DOWNLOAD_PATH) 2>/dev/null || stat -c%s $(EXECUTABLE_DOWNLOAD_PATH)) -lt 1048576 ]; then \
			echo "Error: Downloaded sidecar executable is too small (< 1MB), likely corrupted or failed download" >&2; \
			cat $(EXECUTABLE_DOWNLOAD_PATH) | head -20 >&2; \
			rm -f $(EXECUTABLE_DOWNLOAD_PATH); \
			exit 1; \
	fi && \
	echo "Downloaded sidecar executable to $(EXECUTABLE_DOWNLOAD_PATH) ($$(stat -f%z $(EXECUTABLE_DOWNLOAD_PATH) 2>/dev/null || stat -c%s $(EXECUTABLE_DOWNLOAD_PATH)) bytes)";
endif

# Downloads the THIRD_PARTY_NOTICES.txt file from the latest release of ide-sidecar as THIRD_PARTY_NOTICES_IDE_SIDECAR.txt
.PHONY: download-third-party-notices-sidecar
download-third-party-notices-sidecar:
ifeq ($(CI),true)
	gh release download $(IDE_SIDECAR_VERSION) --repo $(IDE_SIDECAR_REPO) --pattern=THIRD_PARTY_NOTICES.txt --output THIRD_PARTY_NOTICES_IDE_SIDECAR.txt --clobber
endif

.PHONY: generate-third-party-notices
generate-third-party-notices:
	@./scripts/generate-third-party-notices.sh

# Creates a PR against the currently checked out branch with a newly generated `THIRD_PARTY_NOTICES.txt` file.
# Runs `generate-third-party-notices` before creating the PR.
.PHONY: update-third-party-notices-pr
update-third-party-notices-pr:
	@./scripts/update-third-party-notices-pr.sh

.PHONY: collect-notices-vsix
collect-notices-vsix:
	@./scripts/notices/collect-notices-vsix.sh

# Captures the output of the version check, strips away any ANSI escape codes, and posts a comment
# to the PR if the version check fails.
.PHONY: check-sidecar-versions
check-sidecar-versions:
	@./scripts/check-sidecar-versions.sh
