#!/bin/sh
set -eu
DEVELOPER_ROOT="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
SWIFT_COMPILER="$DEVELOPER_ROOT/Toolchains/XcodeDefault.xctoolchain/usr/bin/swiftc"
TEST_BINARY=$(mktemp /tmp/tracker-core.XXXXXX)
trap 'rm -f "$TEST_BINARY"' EXIT
"$SWIFT_COMPILER" -swift-version 6 -warnings-as-errors -parse-as-library watch/MarathonTracker/TrackingCore.swift tests/swift/CoreTests.swift -o "$TEST_BINARY" -sdk "$DEVELOPER_ROOT/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
"$TEST_BINARY"
"$SWIFT_COMPILER" -swift-version 6 -strict-concurrency=complete -warnings-as-errors -typecheck -target arm64_32-apple-watchos11.0 -sdk "$DEVELOPER_ROOT/Platforms/WatchOS.platform/Developer/SDKs/WatchOS.sdk" watch/MarathonTracker/*.swift
plutil -lint watch/MarathonTracker/Info.plist watch/MarathonTracker.xcodeproj/project.pbxproj
