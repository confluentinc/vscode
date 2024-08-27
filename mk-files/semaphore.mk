TEST_RESULT_FILE = $(CURDIR)/TEST-result.xml

.PHONY: store-test-results-to-semaphore
store-test-results-to-semaphore:
ifneq ($(wildcard $(TEST_RESULT_FILE)),)
ifeq ($(TEST_RESULT_NAME),)
	test-results publish $(TEST_RESULT_FILE) --force
else
	test-results publish $(TEST_RESULT_FILE) --name "$(TEST_RESULT_NAME)"
endif
else
	@echo "test results not found at $(TEST_RESULT_FILE)"
endif
