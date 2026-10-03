#!/usr/bin/env bash
set -e

# Stub script to mock adb during integration tests
# Behavior is controlled by FAKE_ADB_SCENARIO env var.

SCENARIO="${FAKE_ADB_SCENARIO:-}"

if [ "${1:-}" = "-s" ]; then
  shift
  shift
fi

command="${1:-}"
shift

if [ "$command" = "version" ]; then
  echo "Android Debug Bridge version 1.0.41"
  echo "Version 34.0.4-10411341"
  exit 0
fi

if [ "$command" = "start-server" ]; then
  exit 0
fi

if [ "$command" = "devices" ]; then
  echo "List of devices attached"
  if [ "$SCENARIO" = "NO_DEVICE" ]; then
    # Return empty list
    exit 0
  fi
  # Otherwise return a fake device
  echo -e "test-device-1\tdevice"
  exit 0
fi

if [ "$command" = "shell" ]; then
  subcommand="$1"
  
  if [ "$subcommand" = "getprop" ] && [ "$2" = "ro.build.version.sdk" ]; then
    echo "33"
    exit 0
  fi
  
  if [ "$subcommand" = "wm" ] && [ "$2" = "size" ]; then
    echo "Physical size: 1080x2400"
    exit 0
  fi
  
  if [ "$subcommand" = "wm" ] && [ "$2" = "density" ]; then
    echo "Physical density: 420"
    exit 0
  fi
  
  if [ "$subcommand" = "pm" ] && [ "$2" = "list" ] && [ "$3" = "packages" ]; then
    # Requested package
    pkg="$4"
    if [ "$SCENARIO" = "NO_APK" ]; then
      exit 0
    fi
    if [ "$SCENARIO" = "VARIANT_MISMATCH" ]; then
      echo "package:com.androperator.operator.dev"
      exit 0
    fi
    # Default is return the requested package
    echo "package:$pkg"
    exit 0
  fi

  if [ "$subcommand" = "dumpsys" ] && [ "$2" = "package" ]; then
    pkg="$3"
    if [ "$SCENARIO" = "VERSION_UNREADABLE" ]; then
      echo "Package [$pkg]"
      exit 0
    fi
    if [ "$SCENARIO" = "VERSION_MISMATCH" ]; then
      echo "Package [$pkg]"
      echo "  versionCode=200000 minSdk=21 targetSdk=35"
      echo "  versionName=0.1.4-d"
      exit 0
    fi
    echo "Package [$pkg]"
    echo "  versionCode=104900 minSdk=21 targetSdk=35"
    echo "  versionName=0.1.4-d"
    exit 0
  fi

  if [ "$subcommand" = "settings" ]; then
    # Dev options / usb debugging
    echo "1"
    exit 0
  fi
fi

if [ "$command" = "logcat" ] && [ "${1:-}" = "-c" ]; then
  exit 0
fi

# Fallback
echo "fake_adb.sh unhandled command: $command $*" >&2
exit 1
