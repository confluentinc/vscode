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

# Markdown links for GH PR comment
GH_PR_PATH_PREFIX=https://github.com/confluentinc/vscode/blob/${SEMAPHORE_GIT_PR_SHA}
IDE_SIDECAR_LINK="[ide-sidecar.txt](${GH_PR_PATH_PREFIX}/${SIDECAR_VERSION_PATH})"
OPENAPI_SPEC_LINK="[sidecar.openapi.yaml](${GH_PR_PATH_PREFIX}/${OPENAPI_SPEC_PATH})"
CLIENT_CODE_LINK="[runtime.ts](${GH_PR_PATH_PREFIX}/${CLIENT_CODE_PATH})"

# Message templates
PR_COMMENT_HEADER="### Sidecar Version Check Failed (https://github.com/confluentinc/vscode/commit/${SEMAPHORE_GIT_PR_SHA})"
OPENAPI_MISMATCH_MSG="Make sure to copy https://github.com/confluentinc/ide-sidecar/blob/v${SIDECAR_VERSION}/src/generated/resources/openapi.yaml to ${OPENAPI_SPEC_LINK}"
CLIENT_MISMATCH_MSG="Make sure to run \`gulp apigen\` to regenerate sidecar client code"

# Compare versions: sidecar vs OpenAPI spec vs client code
if [ "$SIDECAR_VERSION" != "$OPENAPI_SPEC_VERSION" ]; then
    # Show colored output in terminal
    printf "❌ ${RED}OpenAPI spec version mismatch!${NC}\n\n"
    printf "Make sure to copy ${GRAY}%s${NC} to ${BLUE}%s${NC}.\n\n" \
        "https://github.com/confluentinc/ide-sidecar/blob/v${SIDECAR_VERSION}/src/generated/resources/openapi.yaml" \
        "$OPENAPI_SPEC_PATH"
    printf "${GRAY}%s${NC}: ${GREEN}%s${NC}\n" "$SIDECAR_VERSION_PATH" "$SIDECAR_VERSION"
    printf "${GRAY}%s${NC}: ${RED}%s${NC}\n" "$OPENAPI_SPEC_PATH" "$OPENAPI_SPEC_VERSION"

    # Post GitHub comment if in CI
    if [ "$CI" = "true" ] && [ -n "$SEMAPHORE_GIT_PR_NUMBER" ]; then
        echo "Version check failed. Posting comment to PR #$SEMAPHORE_GIT_PR_NUMBER"
        gh api \
            --method POST \
            -H "Accept: application/vnd.github+json" \
            "/repos/confluentinc/vscode/issues/$SEMAPHORE_GIT_PR_NUMBER/comments" \
            -f body="${PR_COMMENT_HEADER}

OpenAPI spec version mismatch:
- ${IDE_SIDECAR_LINK}: \`${SIDECAR_VERSION}\` :white_check_mark:
- ${OPENAPI_SPEC_LINK}: \`${OPENAPI_SPEC_VERSION}\` :x:

${OPENAPI_MISMATCH_MSG}"
    fi
    exit 1

elif [ "$OPENAPI_SPEC_VERSION" != "$CLIENT_VERSION" ]; then
    # Show colored output in terminal
    printf "❌ ${RED}Client code version mismatch!${NC}\n\n"
    printf "Make sure to run '${BLUE}gulp apigen${NC}' to regenerate sidecar client code.\n\n"
    printf "${GRAY}%s${NC}: ${GREEN}%s${NC}\n" "$SIDECAR_VERSION_PATH" "$SIDECAR_VERSION"
    printf "${GRAY}%s${NC}: ${GREEN}%s${NC}\n" "$OPENAPI_SPEC_PATH" "$OPENAPI_SPEC_VERSION"
    printf "${GRAY}%s${NC}: ${RED}%s${NC}\n" "$CLIENT_CODE_PATH" "$CLIENT_VERSION"

    # Post GitHub comment if in CI
    if [ "$CI" = "true" ] && [ -n "$SEMAPHORE_GIT_PR_NUMBER" ]; then
        echo "Version check failed. Posting comment to PR #$SEMAPHORE_GIT_PR_NUMBER"
        gh api \
            --method POST \
            -H "Accept: application/vnd.github+json" \
            "/repos/confluentinc/vscode/issues/$SEMAPHORE_GIT_PR_NUMBER/comments" \
            -f body="${PR_COMMENT_HEADER}

Client code version mismatch:
- ${IDE_SIDECAR_LINK}: \`${SIDECAR_VERSION}\` :white_check_mark:
- ${OPENAPI_SPEC_LINK}: \`${OPENAPI_SPEC_VERSION}\` :white_check_mark:
- ${CLIENT_CODE_LINK}: \`${CLIENT_VERSION}\` :x:

${CLIENT_MISMATCH_MSG}"
    fi
    exit 1
fi

printf "✅ All versions match: ${GREEN}%s${NC}\n" "$SIDECAR_VERSION"
