#!/bin/bash
set -e

# Extract version from ide-sidecar.txt (removing 'v' prefix and whitespace)
SIDECAR_VERSION_PATH=.versions/ide-sidecar.txt
SIDECAR_VERSION=$(cat "${SIDECAR_VERSION_PATH}" | sed 's/^v//' | tr -d '[:space:]')

# Extract version from OpenAPI spec
OPENAPI_SPEC_PATH=src/clients/sidecar-openapi-specs/sidecar.openapi.yaml
OPENAPI_SPEC_VERSION=$(yq '.info.version' "${OPENAPI_SPEC_PATH}")

# Extract version from client code
CLIENT_CODE_PATH=src/clients/sidecar/runtime.ts
CLIENT_VERSION=$(grep -o "version of the OpenAPI document: [0-9.]*" "${CLIENT_CODE_PATH}" | cut -d' ' -f6)

# ANSI color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m'

# Enable color output
export TERM=xterm-color

# Function to capture and post output
handle_version_mismatch() {
    local TEMP_OUTPUT=$(mktemp)
    local MESSAGE="$1"

    # Capture colored output first
    {
        printf "❌ ${RED}%s${NC}\n\n%s\n\n" "$MESSAGE" "$2"
        printf "${GRAY}%s${NC}: ${GREEN}%s${NC}\n" "$SIDECAR_VERSION_PATH" "$SIDECAR_VERSION"
        printf "${GRAY}%s${NC}: %s${NC}\n" "$3" "$4"
        if [ -n "$5" ] && [ -n "$6" ]; then
            printf "${GRAY}%s${NC}: %s${NC}\n" "$5" "$6"
        fi
    } | tee >(sed -E "s/\x1B\[([0-9]{1,3}(;[0-9]{1,3})*)?[mGK]//g" > "$TEMP_OUTPUT")

    # Post GitHub comment if in CI
    if [ "$CI" = "true" ] && [ -n "$SEMAPHORE_GIT_PR_NUMBER" ]; then
        echo "Version check failed. Posting comment to PR #$SEMAPHORE_GIT_PR_NUMBER"
        gh api \
            --method POST \
            -H "Accept: application/vnd.github+json" \
            "/repos/confluentinc/vscode/issues/$SEMAPHORE_GIT_PR_NUMBER/comments" \
            -f body="**Sidecar Version Check Failed** (https://github.com/confluentinc/vscode/commit/$SEMAPHORE_GIT_SHA)

\`\`\`
$(cat "$TEMP_OUTPUT")
\`\`\`

Either:
1. Update [.versions/ide-sidecar.txt](https://github.com/confluentinc/vscode/blob/main/.versions/ide-sidecar.txt) to match the OpenAPI spec version, or
2. Run \`gulp apigen\` to regenerate the client code"
    fi

    rm -f "$TEMP_OUTPUT"
    exit 1
}

# Compare versions: sidecar vs OpenAPI spec vs client code
if [ "$SIDECAR_VERSION" != "$OPENAPI_SPEC_VERSION" ]; then
    handle_version_mismatch \
        "OpenAPI spec version mismatch!" \
        "Make sure to copy ${GRAY}https://github.com/confluentinc/ide-sidecar/blob/v${SIDECAR_VERSION}/src/generated/resources/openapi.yaml${NC} to ${BLUE}${OPENAPI_SPEC_PATH}${NC}." \
        "$OPENAPI_SPEC_PATH" \
        "${RED}$OPENAPI_SPEC_VERSION"
elif [ "$OPENAPI_SPEC_VERSION" != "$CLIENT_VERSION" ]; then
    handle_version_mismatch \
        "Client code version mismatch!" \
        "Make sure to run '${BLUE}gulp apigen${NC}' to regenerate sidecar client code." \
        "$OPENAPI_SPEC_PATH" \
        "${GREEN}$OPENAPI_SPEC_VERSION" \
        "$CLIENT_CODE_PATH" \
        "${RED}$CLIENT_VERSION"
fi

printf "✅ All versions match: ${GREEN}%s${NC}\n" "$SIDECAR_VERSION"
