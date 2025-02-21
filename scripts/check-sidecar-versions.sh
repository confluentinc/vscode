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
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
GRAY='\033[0;90m'
NC='\033[0m'

# Enable color output
export TERM=xterm-color

# Compare versions: sidecar vs OpenAPI spec vs client code
if [ "$SIDECAR_VERSION" != "$OPENAPI_SPEC_VERSION" ]; then
    printf "❌ ${RED}OpenAPI spec version mismatch!${NC}\n\nMake sure to copy ${GRAY}https://github.com/confluentinc/ide-sidecar/blob/v${SIDECAR_VERSION}/src/generated/resources/openapi.yaml${NC} to ${BLUE}%s${NC}.\n\n" "$OPENAPI_SPEC_PATH"
    printf "${GRAY}%s${NC}: ${GREEN}%s${NC}\n" "$SIDECAR_VERSION_PATH" "$SIDECAR_VERSION"
    printf "${GRAY}%s${NC}: ${RED}%s${NC}\n" "$OPENAPI_SPEC_PATH" "$OPENAPI_SPEC_VERSION"
    exit 1
elif [ "$OPENAPI_SPEC_VERSION" != "$CLIENT_VERSION" ]; then
    printf "❌ ${RED}Client code version mismatch!${NC}\n\nMake sure to run '${BLUE}gulp apigen${NC}' to regenerate sidecar client code.\n\n"
    printf "${GRAY}%s${NC}: ${GREEN}%s${NC}\n" "$SIDECAR_VERSION_PATH" "$SIDECAR_VERSION"
    printf "${GRAY}%s${NC}: ${GREEN}%s${NC}\n" "$OPENAPI_SPEC_PATH" "$OPENAPI_SPEC_VERSION"
    printf "${GRAY}%s${NC}: ${RED}%s${NC}\n" "$CLIENT_CODE_PATH" "$CLIENT_VERSION"
    exit 1
fi

printf "✅ ${GREEN}All versions match: ${YELLOW}%s${NC}\n" "$SIDECAR_VERSION"
