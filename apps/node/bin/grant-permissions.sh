#!/usr/bin/env bash
# grant-permissions.sh
# Thin wrapper - delegates to the Node CLI.
# Use: androperator grant-device-permissions [--device <id>] [--operator-package <pkg>]
exec androperator grant-device-permissions "$@"
