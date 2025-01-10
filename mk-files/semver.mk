_empty :=
_space := $(_empty) $(empty)

# Gets added after the version
VERSION_POST ?=

# Auto bump by default
BUMP ?= auto
# If on main branch bump the minor by default
ifeq ($(RELEASE_BRANCH),$(MAIN_BRANCH))
DEFAULT_BUMP ?= minor
# Else bump the patch by default
else
DEFAULT_BUMP ?= patch
endif

# Enable tacking on a timestamp to the versions.
TS ?=

# Filter version tags
VERSION_REFS ?= '*'

GIT_DESCRIBE_MATCH ?= v[0-9]*.[0-9]*.[0-9]*
GIT_DESCRIBE_EXCLUDE ?= v*[^0-9.]!(-ce)!(-SNAPSHOT)*
GIT_DESCRIBE_TAG_FILTERS := --match "$(GIT_DESCRIBE_MATCH)" --exclude "$(GIT_DESCRIBE_EXCLUDE)"

# Version override
VERSION_OVERRIDE ?=

DIRTY := dirty

# For hotfix PRs convert checkout to full clone to make sure git describe can execute properly
ifneq ($(SEMAPHORE_GIT_BRANCH),$(_empty))
ifneq ($(shell echo $(SEMAPHORE_GIT_BRANCH) | grep -E '^v[0-9]+.[0-9]+.x'),$(_empty))
$(shell git fetch --unshallow)
endif
endif

# cut -d -f equals cut --delimiter= --field, short version is compatible with mac
LATEST_VERSION := $(shell git ls-remote --tags --refs --sort="v:refname" origin $(VERSION_REFS) | \
grep -E 'tags/v?[0-9]+\.[0-9]+\.[0-9]+' | tail -n1 | tr -d " \t\n\r" | \
cut -d'/' -f3)
LATEST_VERSION := $(if $(LATEST_VERSION),$(LATEST_VERSION),v0.0.0)
LATEST_VERSION_NO_V := $(shell echo $(LATEST_VERSION) | sed 's,^v,,' )

ifeq ($(BRANCH_NAME),$(MAIN_BRANCH))
# make sure main branch version bump always use the global latest version
ifeq ($(CI), true)
VERSION_SUFFIX := $(shell git describe --tags --always --dirty $(GIT_DESCRIBE_TAG_FILTERS) | rev | cut -d'-' -f 1 | rev)
ifeq ($(VERSION_SUFFIX),$(DIRTY))
# If tag suffix contains dirty
VERSION := $(LATEST_VERSION)-$(VERSION_SUFFIX)
else
VERSION := $(LATEST_VERSION)
endif
else
VERSION := $(shell git describe --tags --always --dirty $(GIT_DESCRIBE_TAG_FILTERS))
endif
else
VERSION := $(shell git describe --tags --always --dirty $(GIT_DESCRIBE_TAG_FILTERS))
endif

ifneq ($(VERSION_OVERRIDE),)
VERSION := $(VERSION_OVERRIDE)
endif

ifneq (,$(findstring dirty,$(VERSION)))
ifeq ($(TS),)
VERSION := $(VERSION)-$(USER)
else
VERSION := $(VERSION)-$(USER)-$(shell date +%s)
endif
endif
CLEAN_VERSION := $(shell echo $(VERSION) | grep -Eo '([0-9]+\.){2}[0-9]+')
VERSION_NO_V = $(shell echo $(VERSION) | sed 's,^v,,' )

CI_SKIP ?= [ci skip]

ifeq ($(CLEAN_VERSION),$(_empty))
CLEAN_VERSION := 0.0.0
else
GIT_MESSAGES := $(shell git log --pretty='%s' v$(CLEAN_VERSION)...HEAD 2>/dev/null | tr '\n' ' ')
endif

# If auto bump enabled, search git messages for bump hash
ifeq ($(BUMP),auto)
_auto_bump_msg := \(auto\)
ifneq (,$(findstring \#major,$(GIT_MESSAGES)))
BUMP := major
else ifneq (,$(findstring \#minor,$(GIT_MESSAGES)))
BUMP := minor
else ifneq (,$(findstring \#patch,$(GIT_MESSAGES)))
BUMP := patch
else
BUMP := $(DEFAULT_BUMP)
endif
endif

# Figure out what the next version should be
split_version := $(subst .,$(_space),$(CLEAN_VERSION))
ifeq ($(BUMP),major)
bump := $(shell expr $(word 1,$(split_version)) + 1)
BUMPED_CLEAN_VERSION := $(bump).0.0
else ifeq ($(BUMP),minor)
bump := $(shell expr $(word 2,$(split_version)) + 1)
BUMPED_CLEAN_VERSION := $(word 1,$(split_version)).$(bump).0
else ifeq ($(BUMP),patch)
bump := $(shell expr $(word 3,$(split_version)) + 1)
BUMPED_CLEAN_VERSION := $(word 1,$(split_version)).$(word 2,$(split_version)).$(bump)
else ifeq ($(BUMP),none)
BUMPED_CLEAN_VERSION := $(word 1,$(split_version)).$(word 2,$(split_version)).$(word 3,$(split_version))
endif

BUMPED_CLEAN_BASE_VERSION := ${BUMPED_CLEAN_VERSION}
BUMPED_BASE_VERSION := v${BUMPED_CLEAN_BASE_VERSION}
BUMPED_CLEAN_VERSION := $(BUMPED_CLEAN_VERSION)$(VERSION_POST)
BUMPED_VERSION := v$(BUMPED_CLEAN_VERSION)

.PHONY: commit-release
commit-release:
	git diff --exit-code --cached --name-status || \
	git commit -m "chore: version bump $(BUMPED_VERSION) $(CI_SKIP)"

SKIP_TAG_RELEASE ?= false

.PHONY: tag-release
ifeq ($(SKIP_TAG_RELEASE),true)
tag-release:
	@echo "Skipping tag-release"
	git push $(GIT_REMOTE_NAME) $(RELEASE_BRANCH) || true
else
tag-release:
	git tag $(BUMPED_VERSION)
	git push $(GIT_REMOTE_NAME) $(BUMPED_VERSION)
	git push $(GIT_REMOTE_NAME) $(RELEASE_BRANCH) || true
endif

# Extract the current version from package.json
CURRENT_VERSION = $(shell cat package.json | jq -r '.version' | sed 's/[",]//g')
CURRENT_SEM_VERSION = $(shell echo $(CURRENT_VERSION) | sed 's/\([0-9]*\.[0-9]*\.[0-9]*\).*/\1/')
# Extract the numeric suffix after the dash from the version string (e.g., "0.5.0-12" -> "12")
CURRENT_MICROVERSION = $(shell echo $(CURRENT_VERSION) | sed -n 's/.*-\([0-9][0-9]*\)$$/\1/p')
# Default to 0 if CURRENT_MICROVERSION is empty
CURRENT_MICROVERSION_DEFAULT = $(if $(CURRENT_MICROVERSION),$(CURRENT_MICROVERSION),0)
# Increment the numeric suffix
BUMPED_MICROVERSION = $(shell expr $(CURRENT_MICROVERSION_DEFAULT) + 1)
# Notice the dash before the microversion
MICROVERSION_POST ?= -$(BUMPED_MICROVERSION)
