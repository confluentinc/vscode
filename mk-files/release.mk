RELEASE_PRECOMMIT := set-node-bumped-version

.PHONY: release-ci
release-ci:
ifeq ($(CI),true)
ifneq ($(RELEASE_BRANCH),$(_empty))
	$(MAKE) $(MAKE_ARGS) pre-release-check $(RELEASE_PRECOMMIT) get-release-image commit-release tag-release create-gh-release
else
# when building a PR, fail if pre-release check fails (e.g. dirty repo)
	$(MAKE) $(MAKE_ARGS) pre-release-check
endif
else
	true
endif

.PHONY: pre-release-check
pre-release-check:
	git diff --exit-code || (echo "ERROR: the repo is not supposed to have local dirty changes prior to releasing" && git status && exit 1)

.PHONY: set-node-bumped-version
set-node-bumped-version:
	test -f package.json \
		&& (npm version $(BUMPED_VERSION) --git-tag-version=false &&\
			git add package.json && git add package-lock.json) \
		|| true

# print the latest non-prerelease GitHub release tag (e.g., v2.3.0)
.PHONY: get-latest-stable-release-tag
get-latest-stable-release-tag:
	@TAG=$$(gh release list --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName'); \
	if [ -z "$$TAG" ] || [ "$$TAG" = "null" ]; then \
		echo "ERROR: Could not determine latest stable release tag." >&2; \
		exit 1; \
	fi; \
	echo "$$TAG"

# download the platform-specific .vsix from the latest stable GitHub release
# Usage: make download-latest-release-vsix
# Usage: make download-latest-release-vsix RELEASE_TAG=v2.3.0
# Usage: make download-latest-release-vsix VSIX_PLATFORM=darwin-arm64
.PHONY: download-latest-release-vsix
download-latest-release-vsix:
	@if [ -z "$(RELEASE_TAG)" ]; then \
		TAG=$$($(MAKE) --no-print-directory $(MAKE_ARGS) get-latest-stable-release-tag); \
	else \
		TAG="$(RELEASE_TAG)"; \
	fi; \
	PLATFORM=$${VSIX_PLATFORM:-linux-x64}; \
	VSIX_DIR="/tmp/vsix"; \
	mkdir -p "$$VSIX_DIR"; \
	echo "Downloading $$PLATFORM .vsix for release $$TAG..."; \
	gh release download "$$TAG" --pattern "*$$PLATFORM*.vsix" --dir "$$VSIX_DIR" --clobber; \
	echo "Downloaded: $$(ls $$VSIX_DIR/*.vsix)"

.PHONY: create-gh-release
create-gh-release:
ifeq ($(CI),true)
ifneq ($(SKIP_TAG_RELEASE),true)
	gh release create $(BUMPED_VERSION) --latest --title "$(BUMPED_VERSION)"
endif
endif
