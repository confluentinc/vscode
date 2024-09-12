include ./mk-files/begin.mk
include ./mk-files/semver.mk
include ./mk-files/release.mk
include ./mk-files/semaphore.mk

# Install node_modules from package-lock.json
.PHONY: install-dependencies
install-dependencies:
	npm ci --prefer-offline
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

VSCODE_EXTENSION_S3_PREFIX ?= vscode

# TODO(oss): Remove this target we start publishing the extension to the marketplace
.PHONY: upload-vsix-files-to-s3
upload-vsix-files-to-s3:
ifeq ($(LATEST_VERSION_NO_V), $(CURRENT_VERSION))
	for target in darwin-x64 darwin-arm64 linux-x64 linux-arm64; do \
		vsix_file=$$(find packaged-vsix-files -name "*$$target*.vsix"); \
		aws s3api put-object --bucket $(S3_BUCKET) --key $(VSCODE_EXTENSION_S3_PREFIX)/$(LATEST_VERSION)/$$(basename $$vsix_file) --body $$vsix_file; \
	done;
else
	@echo "Skipping upload of VSIX files to S3 since the version checked out is not the latest version. Latest version is $(LATEST_VERSION_NO_V) and the version checked out is $(CURRENT_VERSION)"
	exit 1;
endif

.PHONY: upload-vsix-files-to-gh-releases
upload-vsix-files-to-gh-releases:
ifeq ($(LATEST_VERSION_NO_V), $(CURRENT_VERSION))
	for target in darwin-x64 darwin-arm64 linux-x64 linux-arm64; do \
		vsix_file=$$(find packaged-vsix-files -name "*$$target*.vsix"); \
		gh release upload $(LATEST_VERSION) $$vsix_file --clobber; \
	done;
else
	@echo "Skipping upload of VSIX files to GitHub release since the version checked out is not the latest version. Latest version is $(LATEST_VERSION_NO_V) and the version checked out is $(CURRENT_VERSION)"
	exit 1;
endif

S3_BUCKET ?= devprod-prod-blob-store-internal-519856050701
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
	export EXECUTABLE_PATH=ide-sidecar-$(IDE_SIDECAR_VERSION_NO_V)-runner-$(SIDECAR_OS_ARCH) && \
    gh release download $(IDE_SIDECAR_VERSION) --repo $(IDE_SIDECAR_REPO) --pattern=$${EXECUTABLE_PATH} --output $(EXECUTABLE_DOWNLOAD_PATH) --clobber && \
    chmod +x $(EXECUTABLE_DOWNLOAD_PATH) && \
    echo "Downloaded sidecar executable to $(EXECUTABLE_DOWNLOAD_PATH)"
endif

VSIX_MULTIARCH_ARCHIVE_FILENAME := confluent-vscode-extension-multiarch-$(LATEST_VERSION_NO_V).zip

# Downloads the THIRD_PARTY_NOTICES.txt file from the latest release of ide-sidecar as THIRD_PARTY_NOTICES_IDE_SIDECAR.txt
.PHONY: download-third-party-notices-sidecar
download-third-party-notices-sidecar:
ifeq ($(CI),true)
	gh release download $(IDE_SIDECAR_VERSION) --repo $(IDE_SIDECAR_REPO) --pattern=THIRD_PARTY_NOTICES.txt --output THIRD_PARTY_NOTICES_IDE_SIDECAR.txt --clobber
endif

.PHONY: package-multiarch-archive
package-multiarch-archive: download-third-party-notices-sidecar
ifeq ($(CI),true)
	zip -j $(VSIX_MULTIARCH_ARCHIVE_FILENAME) packaged-vsix-files/*.vsix LICENSE.txt NOTICE-vsix.txt THIRD_PARTY_NOTICES* public/CHANGELOG.md public/README.md
endif

.PHONY: push-multiarch-archive
push-multiarch-archive:
ifeq ($(CI),true)
	artifact push workflow $(VSIX_MULTIARCH_ARCHIVE_FILENAME) --destination $(VSIX_MULTIARCH_ARCHIVE_FILENAME)
endif

# TODO(oss): Remove this target we start publishing the extension to the marketplace
.PHONY: upload-multiarch-archive-to-s3
upload-multiarch-archive-to-s3:
ifeq ($(LATEST_VERSION_NO_V), $(CURRENT_VERSION))
ifneq ($(wildcard $(VSIX_MULTIARCH_ARCHIVE_FILENAME)),)
	aws s3api put-object --bucket $(S3_BUCKET) --key $(VSCODE_EXTENSION_S3_PREFIX)/$(LATEST_VERSION)/$(VSIX_MULTIARCH_ARCHIVE_FILENAME) --body $(VSIX_MULTIARCH_ARCHIVE_FILENAME);
endif
else
	@echo "Skipping upload of VSIX multiarch archive to S3 $(LATEST_VERSION_NO_V) and the version checked out is $(CURRENT_VERSION)"
	exit 1;
endif

.PHONY: upload-multiarch-archive-to-gh-releases
upload-multiarch-archive-to-gh-releases:
ifeq ($(LATEST_VERSION_NO_V), $(CURRENT_VERSION))
ifneq ($(wildcard $(VSIX_MULTIARCH_ARCHIVE_FILENAME)),)
	gh release upload $(LATEST_VERSION) $(VSIX_MULTIARCH_ARCHIVE_FILENAME) --clobber
endif
else
	@echo "Skipping upload of VSIX multiarch archive to GitHub release $(LATEST_VERSION_NO_V) and the version checked out is $(CURRENT_VERSION)"
	exit 1;
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
