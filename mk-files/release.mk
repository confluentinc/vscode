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

# look up and check out the release branch (vX.Y.x) based on the provided release tag (vX.Y.Z) 
.PHONY: checkout-release-branch
checkout-release-branch:
	@if [ -z "$(RELEASE_TAG)" ]; then \
		echo "ERROR: RELEASE_TAG is required (e.g., make checkout-release-branch RELEASE_TAG=v2.2.2)" >&2; \
		exit 1; \
	fi; \
	BRANCH=$$(echo "$(RELEASE_TAG)" | sed -E 's/^(v[0-9]+\.[0-9]+)\.[0-9]+$$/\1.x/'); \
	if [ "$$BRANCH" = "$(RELEASE_TAG)" ]; then \
		echo "ERROR: Could not derive release branch from tag '$(RELEASE_TAG)'. Expected vX.Y.Z format." >&2; \
		exit 1; \
	fi; \
	echo "Checking out release branch $$BRANCH for tag $(RELEASE_TAG)..."; \
	git fetch $(GIT_REMOTE_NAME) "$$BRANCH:$$BRANCH" || { echo "ERROR: Branch $$BRANCH not found on $(GIT_REMOTE_NAME)." >&2; exit 1; }; \
	git checkout "$$BRANCH"; \
	echo "Checked out: $$(git rev-parse --abbrev-ref HEAD) at $$(git rev-parse --short HEAD)"

# look up the latest release tag, then check out its associated release branch
.PHONY: checkout-latest-release-branch
checkout-latest-release-branch:
	@TAG=$$($(MAKE) --no-print-directory $(MAKE_ARGS) get-latest-stable-release-tag); \
	echo "Latest stable release: $$TAG"; \
	$(MAKE) --no-print-directory $(MAKE_ARGS) checkout-release-branch RELEASE_TAG=$$TAG

.PHONY: create-gh-release
create-gh-release:
ifeq ($(CI),true)
ifneq ($(SKIP_TAG_RELEASE),true)
	gh release create $(BUMPED_VERSION) --latest --title "$(BUMPED_VERSION)"
endif
endif
