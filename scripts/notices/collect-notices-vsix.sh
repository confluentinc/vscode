#!/bin/bash

# This script extracts from all jars in the specified directory the NOTICE files.
# It then concatenates all NOTICE files into a single NOTICE file in the specified output directory.
# Be aware, that it does not deduplicate contents.

set -Eeuo pipefail

PWD=$(pwd)
DIR=$(dirname "$0")

NOTICE="${PWD}/NOTICE.txt"
TMP_NOTICE_VSIX="${PWD}/NOTICE-vsix.txt.tmp"
NOTICE_VSIX="${PWD}/NOTICE-vsix.txt"
NOTICE_VSIX_PREAMBLE=${DIR}/NOTICE-vsix_PREAMBLE.txt
IDE_SIDECAR_VERSION=$(cat ${PWD}/.versions/ide-sidecar.txt)
IDE_SIDECAR_REPO=confluentinc/ide-sidecar
TMP_IDE_SIDECAR_NOTICE_BINARY="${PWD}/NOTICE-binary.txt.tmp"

append_notice() {
  local notice_file="${1}"
  echo "Appending NOTICE file: ${notice_file}"

  echo -e "\n========================\n" >> "${TMP_NOTICE_VSIX}"
  cat ${notice_file} >> "${TMP_NOTICE_VSIX}"
}

create_vsix_notice() {
  [ -f "${TMP_NOTICE_VSIX}" ] && rm "${TMP_NOTICE_VSIX}"
  cp "${NOTICE}" "${TMP_NOTICE_VSIX}"
  echo -e "\n$(cat ${NOTICE_VSIX_PREAMBLE})" >> "${TMP_NOTICE_VSIX}"

  # Do a fresh install of
  # Save existing `node_modules` directory
  mv node_modules node_modules.bak || true
  NODE_ENV=production npm ci

  notices=( $(find node_modules -name "NOTICE*" | sort) )
  n="${#notices[@]}"
  for ((i=0; i<n; i++))
  do
     notice_file="${notices[$i]}"
     append_notice "${notice_file}"
  done

  mv node_modules.bak node_modules

  # Finally, pull ide-sidecar NOTICE-binary.txt from GH release
  gh release download ${IDE_SIDECAR_VERSION} --repo ${IDE_SIDECAR_REPO} --pattern "NOTICE-binary.txt" --output ${TMP_IDE_SIDECAR_NOTICE_BINARY}
  append_notice "${TMP_IDE_SIDECAR_NOTICE_BINARY}"
}

# Create and do an atomic copy of the NOTICE
create_vsix_notice && cp "${TMP_NOTICE_VSIX}" "${NOTICE_VSIX}"

# Clean up
rm ${TMP_NOTICE_VSIX} ${TMP_IDE_SIDECAR_NOTICE_BINARY}
