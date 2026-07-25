#!/bin/sh
set -eu

# This script starts Renovate, as the original USER of the renovate/renovate
# image. But first, it truncates the log (which requires root on Linux hosts).
# And after Renovate finished, it chowns the log so that the host's user/group owns it.
# This is necessary, because:
# 1) Renovate appends to the log, which would make repeated tests difficult
# 2) On Linux hosts, we want the log to be owned by the host's user/group
# 3) Renovate needs to run as its original user, or it would be unable to
#    use the install-tool successfully, due to permission issues with /opt

renovate_uid="$(id -u ubuntu)"
renovate_gid="$(id -g ubuntu)"
child_pid=""

truncate --size 0 "${LOG_FILE}"
chown "${renovate_uid}:${renovate_gid}" "${LOG_FILE}"

cleanup() {
    chown "${HOST_UID}:${HOST_GID}" "${LOG_FILE}"
}

forward_signal() {
    if [ -n "${child_pid}" ]; then
        kill -TERM "${child_pid}" 2>/dev/null || true
    fi
}

trap cleanup EXIT
trap forward_signal HUP INT TERM

setpriv \
    --reuid="${renovate_uid}" \
    --regid="${renovate_gid}" \
    --init-groups \
    /usr/local/sbin/renovate-entrypoint.sh "$@" &
child_pid="$!"

set +e
wait "${child_pid}"
status="$?"
set -e

exit "${status}"
