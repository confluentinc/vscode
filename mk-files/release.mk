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

.PHONY: create-gh-release
create-gh-release:
ifeq ($(CI),true)
ifneq ($(SKIP_TAG_RELEASE),true)
	gh release create $(BUMPED_VERSION) --latest --title "$(BUMPED_VERSION)"
endif
endif
