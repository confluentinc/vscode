#!/bin/bash

maybe_install_fossa_cli(){
  mkdir -p ${HOME}/bin
  export BIN=${HOME}/bin
  export PATH="${PATH}:${BIN}"
  which fossa && return

  curl https://confluent-packaging-tools-891377121322-us-west-2.s3.us-west-2.amazonaws.com/fossa_3.6.8_linux_amd64.zip -o fossa.zip
  unzip fossa.zip
  rm fossa.zip

  mv fossa ${BIN}/fossa

  command -v fossa || { echo "could not install fossa"; exit 1; }
}

retry() {
  command=$1
  num_retries=$2

  for i in $(seq 1 $num_retries); do
    echo "Attempt $i: $command"
    eval $command && return
    sleep 5

    if [ $i -eq $num_retries ]; then
      echo "Failed after $num_retries attempts: $command"
      return 1
    fi
  done
}

main() {
  maybe_install_fossa_cli

  # Full access token created using rsanjay@confluent.io's FOSSA account (on Jul 17, 2024).
  # Rotate every 80-180 days.
  # https://docs.fossa.com/docs/rotating-fossa-api-key#full-access-token
  export FOSSA_API_KEY=$(vault kv get -field api_key v1/ci/kv/fossa_full_access)
  fossa analyze --exclude-path mk-files --only-target npm

  # This might timeout so retry a few times
  retry "fossa report attribution --format text > THIRD_PARTY_NOTICES.txt" 3
}

main
