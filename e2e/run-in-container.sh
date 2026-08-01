#!/bin/sh
# Run the E2E suite inside the frozen screenshot environment.
#
# Usage: e2e/run-in-container.sh compare|update
#
# Everything about the resulting pixels — Chromium build, font files, fontconfig
# — is fixed by e2e/Dockerfile, which is what makes the committed baselines a
# meaningful contract. See README.md and e2e/screenshot.ts.
set -eu

mode="${1:-}"
case "$mode" in
compare | update) ;;
*)
  echo "usage: $0 compare|update" >&2
  exit 2
  ;;
esac

# Keep the browser pinned to the exact playwright-core the tests import, rather
# than letting the image drift away from package.json.
playwright_version=$(node -p "require('./package.json').devDependencies['playwright-core']")
image="renovate-log-parser-e2e:pw${playwright_version}"

docker build \
  --build-arg "PLAYWRIGHT_VERSION=${playwright_version}" \
  --tag "$image" \
  --file e2e/Dockerfile \
  e2e

# --user: the suite writes dist/, web/.output/, e2e-artifacts/ and (in update
#         mode) the baselines straight into the mounted work tree, which must
#         not end up owned by root.
# --ipc=host: Chromium exhausts the default 64MB /dev/shm and crashes.
# HOME/npm cache: /tmp, because that host UID has no home inside the image.
exec docker run --rm --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  --volume "$PWD:/work" \
  --workdir /work \
  --env HOME=/tmp \
  --env npm_config_cache=/tmp/.npm \
  --env RLP_E2E_CONTAINER=1 \
  --env "RLP_SCREENSHOTS=$mode" \
  "$image" \
  npm run test:e2e
