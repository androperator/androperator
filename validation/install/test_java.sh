#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")/../.."

REPO_ROOT="$(pwd)"
INSTALL_SCRIPT="$REPO_ROOT/sites/landing-clawperator/public/install.sh"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

assert_contains() {
    local needle="$1"
    local file="$2"
    if ! grep -Fq "$needle" "$file"; then
        echo "Expected to find: $needle"
        echo "In file: $file"
        cat "$file"
        exit 1
    fi
}

link_required_shell_tools() {
    local stub_bin="$1"
    local tool
    for tool in bash cat grep head rm tr; do
        ln -sf "$(command -v "$tool")" "$stub_bin/$tool"
    done
}

run_valid_java_home_case() (
    local case_dir="$1"
    local stub_bin="$case_dir/bin"
    local java_home="$case_dir/java-home/existing"

    mkdir -p "$stub_bin" "$java_home/bin"

    cat > "$stub_bin/java" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'openjdk version "11.0.20" 2023-07-18' >&2
EOF

    cat > "$java_home/bin/java" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'openjdk version "17.0.9" 2023-10-17' >&2
EOF

    cat > "$stub_bin/brew" <<'EOF'
#!/usr/bin/env bash
echo "brew should not have been called" >&2
exit 99
EOF

    chmod +x "$stub_bin/java" "$stub_bin/brew" "$java_home/bin/java"

    export PATH="$stub_bin:$PATH"
    export OS=Darwin
    export JAVA_HOME="$java_home"
    export CLAWPERATOR_TEMURIN_17_HOME="$case_dir/java-home/temurin-17"
    hash -r

    # shellcheck disable=SC1090
    source "$INSTALL_SCRIPT"

    check_java > "$case_dir/output.txt"

    if [ "$JAVA_HOME" != "$java_home" ]; then
        echo "Expected JAVA_HOME to remain unchanged when a valid JDK already exists."
        echo "Got: $JAVA_HOME"
        exit 1
    fi

    if [ "$(command -v java)" != "$java_home/bin/java" ]; then
        echo "Expected PATH to be updated to use the preserved JAVA_HOME."
        echo "Got: $(command -v java)"
        exit 1
    fi

    assert_contains "Java detected via JAVA_HOME" "$case_dir/output.txt"
)

run_homebrew_install_case() (
    local case_dir="$1"
    local stub_bin="$case_dir/bin"
    local java_home="$case_dir/java-home/old-jdk"
    local temurin_home="$case_dir/java-home/temurin-17"
    local version_file="$case_dir/java-version.txt"

    mkdir -p "$stub_bin" "$java_home" "$temurin_home/bin"
    printf '%s\n' 'openjdk version "11.0.20" 2023-07-18' > "$version_file"

    cat > "$stub_bin/java" <<EOF
#!/usr/bin/env bash
cat "$version_file" >&2
EOF

    cat > "$temurin_home/bin/java" <<EOF
#!/usr/bin/env bash
cat "$version_file" >&2
EOF

    cat > "$stub_bin/brew" <<EOF
#!/usr/bin/env bash
printf '%s\n' 'brew install --cask temurin@17' >&2
printf '%s\n' 'openjdk version "17.0.9" 2023-10-17' > "$version_file"
exit 0
EOF

    cat > "$stub_bin/hash" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

    chmod +x "$stub_bin/java" "$stub_bin/brew" "$stub_bin/hash" "$temurin_home/bin/java"

    export PATH="$stub_bin:$PATH"
    export OS=Darwin
    export JAVA_HOME="$java_home"
    export CLAWPERATOR_TEMURIN_17_HOME="$temurin_home"
    hash -r

    # shellcheck disable=SC1090
    source "$INSTALL_SCRIPT"

    check_java > "$case_dir/output.txt"

    if [ "$JAVA_HOME" != "$temurin_home" ]; then
        echo "Expected JAVA_HOME to be reset to the installed Temurin JDK."
        echo "Got: $JAVA_HOME"
        exit 1
    fi

    if [ "$(command -v java)" != "$temurin_home/bin/java" ]; then
        echo "Expected the installed Temurin JDK to be first on PATH."
        echo "Got: $(command -v java)"
        exit 1
    fi

    assert_contains "Set JAVA_HOME to $temurin_home" "$case_dir/output.txt"
    assert_contains "Java detected successfully:" "$case_dir/output.txt"
)

run_macos_java_stub_case() (
    local case_dir="$1"
    local stub_bin="$case_dir/bin"
    local temurin_home="$case_dir/java-home/temurin-17"
    local version_file="$case_dir/java-version.txt"

    mkdir -p "$stub_bin" "$temurin_home/bin"
    printf '%s\n' 'No Java runtime present, requesting install.' > "$version_file"

    cat > "$stub_bin/java" <<EOF
#!/usr/bin/env bash
cat "$version_file" >&2
exit 1
EOF

    cat > "$temurin_home/bin/java" <<EOF
#!/usr/bin/env bash
cat "$version_file" >&2
EOF

    cat > "$stub_bin/brew" <<EOF
#!/usr/bin/env bash
printf '%s\n' 'brew install --cask temurin@17' >&2
printf '%s\n' 'openjdk version "17.0.9" 2023-10-17' > "$version_file"
exit 0
EOF

    chmod +x "$stub_bin/java" "$stub_bin/brew" "$temurin_home/bin/java"

    export PATH="$stub_bin:$PATH"
    export OS=Darwin
    unset JAVA_HOME || true
    export CLAWPERATOR_TEMURIN_17_HOME="$temurin_home"
    hash -r

    # shellcheck disable=SC1090
    source "$INSTALL_SCRIPT"

    check_java > "$case_dir/output.txt"

    if [ "$JAVA_HOME" != "$temurin_home" ]; then
        echo "Expected JAVA_HOME to be set to the installed Temurin JDK."
        echo "Got: $JAVA_HOME"
        exit 1
    fi

    assert_contains "Java not found. Installing Java 17" "$case_dir/output.txt"
    assert_contains "Set JAVA_HOME to $temurin_home" "$case_dir/output.txt"
    assert_contains "Java detected successfully:" "$case_dir/output.txt"
)

run_linux_apt_install_case() (
    local case_dir="$1"
    local stub_bin="$case_dir/bin"
    local version_file="$case_dir/java-version.txt"

    mkdir -p "$stub_bin"
    printf '%s\n' 'openjdk version "11.0.20" 2023-07-18' > "$version_file"

    cat > "$stub_bin/java" <<EOF
#!/usr/bin/env bash
cat "$version_file" >&2
EOF

    cat > "$stub_bin/apt-get" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "update" ]; then
    exit 0
fi

if [ "\$1" = "install" ]; then
    printf '%s\n' 'openjdk version "17.0.9" 2023-10-17' > "$version_file"
    exit 0
fi

exit 1
EOF

    cat > "$stub_bin/sudo" <<'EOF'
#!/usr/bin/env bash
"$@"
EOF

    chmod +x "$stub_bin/java" "$stub_bin/apt-get" "$stub_bin/sudo"

    export PATH="$stub_bin:$PATH"
    export OS=Linux
    unset JAVA_HOME || true
    hash -r

    # shellcheck disable=SC1090
    source "$INSTALL_SCRIPT"

    check_java > "$case_dir/output.txt"

    assert_contains "Installing OpenJDK 17 via apt" "$case_dir/output.txt"
    assert_contains "Java detected successfully:" "$case_dir/output.txt"
)

run_linux_pacman_install_case() (
    local case_dir="$1"
    local stub_bin="$case_dir/bin"
    local version_file="$case_dir/java-version.txt"

    mkdir -p "$stub_bin"
    link_required_shell_tools "$stub_bin"
    printf '%s\n' 'openjdk version "11.0.20" 2023-07-18' > "$version_file"

    cat > "$stub_bin/java" <<EOF
#!/usr/bin/env bash
cat "$version_file" >&2
EOF

    cat > "$stub_bin/pacman" <<EOF
#!/usr/bin/env bash
if [ "\$1" = "-S" ]; then
    printf '%s\n' 'openjdk version "17.0.9" 2023-10-17' > "$version_file"
    exit 0
fi

exit 1
EOF

    cat > "$stub_bin/sudo" <<'EOF'
#!/usr/bin/env bash
"$@"
EOF

    chmod +x "$stub_bin/java" "$stub_bin/pacman" "$stub_bin/sudo"

    export PATH="$stub_bin"
    export OS=Linux
    unset JAVA_HOME || true
    hash -r

    # shellcheck disable=SC1090
    source "$INSTALL_SCRIPT"

    check_java > "$case_dir/output.txt"

    assert_contains "Installing OpenJDK 17 via pacman" "$case_dir/output.txt"
    assert_contains "Java detected successfully:" "$case_dir/output.txt"
)

run_linux_conflict_case() (
    local case_dir="$1"
    local stub_bin="$case_dir/bin"
    local version_file="$case_dir/java-version.txt"

    mkdir -p "$stub_bin"
    printf '%s\n' 'openjdk version "11.0.20" 2023-07-18' > "$version_file"

    cat > "$stub_bin/java" <<EOF
#!/usr/bin/env bash
cat "$version_file" >&2
EOF

    cat > "$stub_bin/apt-get" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = "update" ]; then
    exit 0
fi

if [ "$1" = "install" ]; then
    printf '%s\n' 'Conflicts: openjdk-11-jdk' >&2
    exit 100
fi

exit 1
EOF

    cat > "$stub_bin/sudo" <<'EOF'
#!/usr/bin/env bash
"$@"
EOF

    cat > "$stub_bin/uname" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' 'Linux'
EOF

    chmod +x "$stub_bin/java" "$stub_bin/apt-get" "$stub_bin/sudo" "$stub_bin/uname"

    export PATH="$stub_bin:$PATH"
    export OS=Linux
    unset JAVA_HOME || true
    hash -r

    # shellcheck disable=SC1090
    source "$INSTALL_SCRIPT"

    if check_java > "$case_dir/output.txt"; then
        echo "Expected the Linux conflict case to fail."
        cat "$case_dir/output.txt"
        exit 1
    fi

    assert_contains "package manager reported a conflict" "$case_dir/output.txt"
    assert_contains "adoptium.net/temurin/releases" "$case_dir/output.txt"
    assert_contains "Conflicts: openjdk-11-jdk" "$case_dir/output.txt"
)

run_valid_java_home_case "$TMP_DIR/valid-java-home"
run_homebrew_install_case "$TMP_DIR/homebrew-install"
run_macos_java_stub_case "$TMP_DIR/macos-java-stub"
run_linux_apt_install_case "$TMP_DIR/linux-apt-install"
run_linux_pacman_install_case "$TMP_DIR/linux-pacman-install"
run_linux_conflict_case "$TMP_DIR/linux-conflict"

echo "validation/install/test_java.sh: pass"
