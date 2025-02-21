include ./mk-files/begin.mk
include ./mk-files/semver.mk
include ./mk-files/release.mk
include ./mk-files/semaphore.mk

# Install node_modules from package-lock.json
.PHONY: install-dependencies
install-dependencies:
	npm ci --prefer-offline --include=dev
	npx playwright install

.PHONY: setup-test-env
setup-test-env:
	@echo "Pulling automated-test-user credentials from Vault into .env file for testing"
	@echo "E2E_USERNAME=$(shell vault kv get -field=E2E_USERNAME v1/ci/kv/vscodeextension/testing)" > .env
	@echo "E2E_PASSWORD=$(shell vault kv get -field=E2E_PASSWORD v1/ci/kv/vscodeextension/testing)" >> .env

.PHONY: remove-test-env
remove-test-env:
	@echo "Removing .env file"
	@rm -f .env

# Install additional dependencies to run VSCode testing in headless mode
# ref: https://code.visualstudio.com/api/working-with-extensions/continuous-integration#github-actions
.PHONY: test
test: setup-test-env install-dependencies
	sudo apt-get update
	sudo apt install -y libgbm1 libgtk-3-0 xvfb
	npx gulp ci
	xvfb-run -a npx gulp test
	npx gulp functional

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
EXECUTABLE_DOWNLOAD_PATH := bin/ide-sidecar-$(IDE_SIDECAR_VERSION_NO_V)-runner

# Skip download if the executable already exists and is executable
SKIP_DOWNLOAD_EXECUTABLE := $(shell [ -x $(EXECUTABLE_DOWNLOAD_PATH) ] && echo true || echo false)

# Get the OS and architecture combination for the sidecar executable
SIDECAR_OS_ARCH ?= $(shell echo "$$(uname -s | tr '[:upper:]' '[:lower:]' | sed 's/darwin/macos/')-$$(uname -m | sed 's/x86_64/amd64/')" )

IDE_SIDECAR_REPO := confluentinc/ide-sidecar

# This target is meant for non-Windows platforms to download the sidecar executable
# For Windows, we use scripts/windows/download-sidecar-executable.ps1
.PHONY: download-sidecar-executable
download-sidecar-executable:
ifeq ($(SKIP_DOWNLOAD_EXECUTABLE),true)
	@echo "Skipping download of sidecar executable since it already exists at $(EXECUTABLE_DOWNLOAD_PATH)"
else
	mkdir -p bin && \
	echo "Using curl to download sidecar executable from GitHub release $(IDE_SIDECAR_VERSION)"; \
	export EXECUTABLE_PATH=ide-sidecar-$(IDE_SIDECAR_VERSION_NO_V)-runner-$(SIDECAR_OS_ARCH) && \
		curl --fail -L -o $(EXECUTABLE_DOWNLOAD_PATH) "https://github.com/$(IDE_SIDECAR_REPO)/releases/download/$(IDE_SIDECAR_VERSION)/$${EXECUTABLE_PATH}" && \
		chmod +x $(EXECUTABLE_DOWNLOAD_PATH) && \
		echo "Downloaded sidecar executable to $(EXECUTABLE_DOWNLOAD_PATH)";
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

.PHONY: check-sidecar-versions
check-sidecar-versions:
	@TEMP_OUTPUT=$$(mktemp) && \
		COLORED_OUTPUT=$$(mktemp) && \
		./scripts/check-sidecar-versions.sh > $$COLORED_OUTPUT 2>&1; \
		EXIT_CODE=$$?; \
		# Strip ANSI color codes for GitHub comment
		cat "$$COLORED_OUTPUT" | sed -E "s/\x1B\[([0-9]{1,3}(;[0-9]{1,3})*)?[mGK]//g" > "$$TEMP_OUTPUT"; \
		if [ $$EXIT_CODE -ne 0 ] && [ "$$CI" = "true" ] && [ -n "$$SEMAPHORE_GIT_PR_NUMBER" ]; then \
			echo "Version check failed. Posting comment to PR #$$SEMAPHORE_GIT_PR_NUMBER"; \
			gh api \
				--method POST \
				-H "Accept: application/vnd.github+json" \
				/repos/confluentinc/vscode/issues/$$SEMAPHORE_GIT_PR_NUMBER/comments \
				-f body="❌ **Sidecar Version Check Failed** ([$$SEMAPHORE_GIT_SHA](https://github.com/confluentinc/vscode/commit/$$SEMAPHORE_GIT_SHA))\n\n\`\`\`\n$$(cat $$TEMP_OUTPUT)\n\`\`\`\n\nEither:\n1. Update [.versions/ide-sidecar.txt](https://github.com/confluentinc/vscode/blob/main/.versions/ide-sidecar.txt) to match the OpenAPI spec version, or\n2. Run \`gulp apigen\` to regenerate the client code"; \
		fi; \
		# Show colored output in terminal
		cat $$COLORED_OUTPUT; \
		rm -f $$TEMP_OUTPUT $$COLORED_OUTPUT; \
		exit $$EXIT_CODE
