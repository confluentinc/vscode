TEST_RESULT_FILE = $(CURDIR)/TEST-result.xml
TEST_RESULT_E2E_FILE = $(CURDIR)/TEST-result-e2e.xml
TEST_RESULT_WEBVIEW_FILE = $(CURDIR)/TEST-result-webview.xml

# How many days cache entries can stay in the semaphore cache before they are considered stale
SEM_CACHE_DURATION_DAYS ?= 7
current_time := $(shell date +"%s")
# OS Name
os_name := $(shell uname -s)
os_name_and_arch := $(shell echo "$$(uname -s | tr '[:upper:]' '[:lower:]' | sed 's/darwin/macos/')-$$(uname -m | sed 's/x86_64/amd64/' | sed 's/aarch64/arm64/')")

.PHONY: store-test-results-to-semaphore
store-test-results-to-semaphore:
	@echo "Publishing test results to Semaphore..."
ifneq ($(wildcard $(TEST_RESULT_FILE)),)
ifeq ($(TEST_RESULT_NAME),)
	test-results publish $(TEST_RESULT_FILE) --force
	@echo "Published Mocha test results from $(TEST_RESULT_FILE)"
else
	test-results publish $(TEST_RESULT_FILE) --name "$(TEST_RESULT_NAME)"
	@echo "Published Mocha test results from $(TEST_RESULT_FILE) with name $(TEST_RESULT_NAME)"
endif
else
	@echo "Mocha test results not found at $(TEST_RESULT_FILE)"
endif
ifneq ($(wildcard $(TEST_RESULT_E2E_FILE)),)
	test-results publish $(TEST_RESULT_E2E_FILE) --name "VS Code ($${VSCODE_VERSION:-stable}) Extension Tests: E2E ($(os_name_and_arch))" --force
	@echo "Published E2E test results from $(TEST_RESULT_E2E_FILE)"
else
	@echo "E2E test results not found at $(TEST_RESULT_E2E_FILE)"
endif
ifneq ($(wildcard $(TEST_RESULT_WEBVIEW_FILE)),)
	test-results publish $(TEST_RESULT_WEBVIEW_FILE) --name "VS Code ($${VSCODE_VERSION:-stable}) Extension Tests: Webview ($(os_name_and_arch))" --force
	@echo "Published Webview test results from $(TEST_RESULT_WEBVIEW_FILE)"
else
	@echo "Webview test results not found at $(TEST_RESULT_WEBVIEW_FILE)"
endif

# Only write to the cache from main builds because of security reasons.
.PHONY: ci-bin-sem-cache-store
ci-bin-sem-cache-store:
ifneq ($(SEMAPHORE_GIT_REF_TYPE),pull-request)
	@echo "Storing semaphore caches"
	$(MAKE) _ci-bin-sem-cache-store SEM_CACHE_KEY=$(os_name_and_arch)_npm_cache SEM_CACHE_PATH=$(HOME)/.npm
# Cache packages installed by `npx playwright install`
	[[ $(os_name) == "Darwin" ]] && $(MAKE) _ci-bin-sem-cache-store SEM_CACHE_KEY=$(os_name_and_arch)_playwright_cache SEM_CACHE_PATH=$(HOME)/Library/Caches/ms-playwright || true
	[[ $(os_name) == "Linux" ]] && $(MAKE) _ci-bin-sem-cache-store SEM_CACHE_KEY=$(os_name_and_arch)_playwright_cache SEM_CACHE_PATH=$(HOME)/.cache/ms-playwright || true
endif

# cache restore allows fuzzy matching. When it finds multiple matches, it will select the most recent cache archive.
# Additionally, it will not overwrite an existing cache archive with the same key.
# Therefore, we store the cache with a timestamp in the key to avoid collisions.
#
# But caching can be expensive, so we'll only recache an item if the previous item was cached a while ago,
# we arbitrarily put seven days ago for now, see the logic in _ci-bin-sem-cache-store
.PHONY: _ci-bin-sem-cache-store
_ci-bin-sem-cache-store:
	@stored_timestamp=$$(cache list | grep $(SEM_CACHE_KEY)_ | awk '{print $$1}' | awk -F_ '{print $$NF}' | sort -r | awk 'NR==1'); \
	if [ -z "$$stored_timestamp" ]; then \
		echo "Cache entry $(SEM_CACHE_KEY) does not exist in the cache, try to store it..."; \
		cache store $(SEM_CACHE_KEY)_$(current_time) $(SEM_CACHE_PATH); \
	else \
		threshold_timestamp=$$(date -d "$(SEM_CACHE_DURATION_DAYS) days ago" +%s); \
		if [ "$$stored_timestamp" -lt "$$threshold_timestamp" ]; then \
			echo "Existing entry $(SEM_CACHE_KEY) is too old, storing it again..."; \
			cache store $(SEM_CACHE_KEY)_$(current_time) $(SEM_CACHE_PATH); \
		else \
			echo "Cache entry $(SEM_CACHE_KEY) was updated recently, skipping..."; \
		fi \
	fi

.PHONY: ci-bin-sem-cache-restore
ci-bin-sem-cache-restore:
	@echo "Restoring semaphore caches"
	cache restore $(os_name_and_arch)_npm_cache
	cache restore $(os_name_and_arch)_playwright_cache || true
