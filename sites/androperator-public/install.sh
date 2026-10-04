#!/usr/bin/env bash

# install.sh (v1.0.0)
# One-command installation for Androperator CLI and environment.
# Target: macOS and Linux (Ubuntu/Debian/Arch).

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

RELEASE_OPERATOR_PACKAGE="com.androperator.operator"
trim_whitespace() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    printf '%s' "$value"
}

resolve_operator_package() {
    local candidate="${ANDROPERATOR_OPERATOR_PACKAGE:-}"
    candidate="$(trim_whitespace "$candidate")"
    if [ -n "$candidate" ]; then
        printf '%s' "$candidate"
    else
        printf '%s' "$RELEASE_OPERATOR_PACKAGE"
    fi
}

DEFAULT_OPERATOR_PACKAGE="$(resolve_operator_package)"
APK_FILE_BASENAME="operator.apk"
if [ "$DEFAULT_OPERATOR_PACKAGE" != "$RELEASE_OPERATOR_PACKAGE" ]; then
    APK_FILE_BASENAME="operator-debug.apk"
fi
INSTALL_COMMAND="curl -fsSL https://androperator.com/install.sh | bash"
ANDROPERATOR_BIN_PATH=""

on_error() {
    local line_number="$1"
    echo -e "${RED}❌ Installation failed (line ${line_number}).${NC}"
    echo -e "${YELLOW}Review the error above, fix prerequisites, then re-run:${NC}"
    echo -e "${YELLOW}${INSTALL_COMMAND}${NC}"
}

trap 'on_error $LINENO' ERR

# 1. OS Detection
# Allow tests to inject OS via an exported variable; detect automatically otherwise.
# Assigned at top level so all functions can reference $OS when sourced.
OS="${OS:-$(uname -s)}"

validate_os() {
    case "$OS" in
        Darwin|Linux) return 0 ;;
        *)
            echo -e "${RED}❌ Unsupported OS: $OS${NC}"
            echo -e "${YELLOW}This installer supports macOS and Linux only.${NC}"
            return 1
            ;;
    esac
}

java_output_is_supported() {
    local output_lower
    output_lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    case "$output_lower" in
        *'version "17'*|*'version "21'*|*'openjdk 17'*|*'openjdk 21'*)
            return 0
            ;;
    esac
    return 1
}

java_output_indicates_missing_runtime() {
    local output_lower
    output_lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    case "$output_lower" in
        *"no java runtime present"*|*"unable to locate a java runtime"*)
            return 0
            ;;
    esac
    return 1
}

java_version_first_line() {
    printf '%s\n' "$1" | head -n 1
}

java_install_conflict_detected() {
    local output_lower
    output_lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    case "$output_lower" in
        *conflict*|*"held broken packages"*|*"conflicting files"*|*"failed to commit transaction"*|*"would remove"*)
            return 0
            ;;
    esac
    return 1
}

# 2. Check Java (Java 17 or 21 required for Android builds)
# Returns: 0 if valid Java is available, 1 on failure
# Three-state detection: valid (skip), missing (install), incompatible (warn+install)
check_java() {
    local java_version_output=""
    local java_check_status="missing"
    local java_home_output=""
    local java_version_status=0

    # Prefer a valid JAVA_HOME before touching the system install.
    if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
        java_home_output="$("${JAVA_HOME}/bin/java" -version 2>&1 || true)"
        if java_output_is_supported "$java_home_output"; then
            java_version_output="$java_home_output"
            export PATH="${JAVA_HOME}/bin:${PATH}"
            hash -r
            echo -e "${GREEN}✅ Java detected via JAVA_HOME: $(java_version_first_line "$java_version_output")${NC}"
            return 0
        fi
    fi

    # Check if java is on PATH
    if command -v java &> /dev/null; then
        if java_version_output="$(java -version 2>&1)"; then
            java_version_status=0
        else
            java_version_status=$?
        fi

        if [ "$java_version_status" -eq 0 ] && java_output_is_supported "$java_version_output"; then
            java_check_status="valid"
        elif java_output_indicates_missing_runtime "$java_version_output"; then
            java_check_status="missing"
        else
            java_check_status="incompatible"
        fi
    fi

    case "$java_check_status" in
        valid)
            echo -e "${GREEN}✅ Java detected: $(java_version_first_line "$java_version_output")${NC}"
            return 0
            ;;
        incompatible)
            echo -e "${YELLOW}⚠️  Incompatible Java version detected:${NC}"
            echo -e "${YELLOW}   $(java_version_first_line "$java_version_output")${NC}"
            echo -e "${YELLOW}   Java 17 or 21 is required for Android builds. Installing Java 17...${NC}"
            ;;
        missing)
            echo -e "${YELLOW}⚠️  Java not found. Installing Java 17...${NC}"
            ;;
    esac

    # Provisioning based on platform
    if [ "$OS" == "Darwin" ]; then
        if command -v brew &> /dev/null; then
            echo "Installing Temurin JDK 17 via Homebrew..."
            if ! brew install --cask temurin@17; then
                echo -e "${RED}❌ Failed to install Java via Homebrew.${NC}"
                echo -e "${YELLOW}Please install Java 17 manually from: https://adoptium.net/temurin/releases/${NC}"
                return 1
            fi
            local temurin_home="${ANDROPERATOR_TEMURIN_17_HOME:-/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home}"
            if [ -d "$temurin_home" ]; then
                export JAVA_HOME="$temurin_home"
                echo -e "${BLUE}Set JAVA_HOME to $temurin_home${NC}"
                export PATH="${temurin_home}/bin:${PATH}"
                hash -r
            fi
        else
            echo -e "${RED}❌ Homebrew not found. Please install Java 17 manually:${NC}"
            echo -e "${YELLOW}https://adoptium.net/temurin/releases/${NC}"
            return 1
        fi
    elif [ "$OS" == "Linux" ]; then
        if command -v apt-get &> /dev/null; then
            echo "Installing OpenJDK 17 via apt..."
            if ! sudo apt-get update; then
                echo -e "${RED}❌ Failed to update apt package lists.${NC}"
                echo -e "${YELLOW}Please install Java 17 manually from: https://adoptium.net/temurin/releases/${NC}"
                return 1
            fi
            local apt_install_output
            if ! apt_install_output="$(sudo apt-get install -y openjdk-17-jdk 2>&1)"; then
                if java_install_conflict_detected "$apt_install_output"; then
                    echo -e "${RED}❌ The package manager reported a conflict that may require removing the existing JDK.${NC}"
                    echo -e "${YELLOW}Please install Java 17 manually from: https://adoptium.net/temurin/releases/${NC}"
                    printf '%s%s%s\n' "$YELLOW" "$apt_install_output" "$NC"
                    return 1
                fi
                echo -e "${RED}❌ Failed to install Java via apt.${NC}"
                printf '%s%s%s\n' "$YELLOW" "$apt_install_output" "$NC"
                echo -e "${YELLOW}Please install Java 17 manually from: https://adoptium.net/temurin/releases/${NC}"
                return 1
            fi
        elif command -v pacman &> /dev/null; then
            echo "Installing OpenJDK 17 via pacman..."
            local pacman_install_output
            if ! pacman_install_output="$(sudo pacman -S --noconfirm jdk17-openjdk 2>&1)"; then
                if java_install_conflict_detected "$pacman_install_output"; then
                    echo -e "${RED}❌ The package manager reported a conflict that may require removing the existing JDK.${NC}"
                    echo -e "${YELLOW}Please install Java 17 manually from: https://adoptium.net/temurin/releases/${NC}"
                    printf '%s%s%s\n' "$YELLOW" "$pacman_install_output" "$NC"
                    return 1
                fi
                echo -e "${RED}❌ Failed to install Java via pacman.${NC}"
                printf '%s%s%s\n' "$YELLOW" "$pacman_install_output" "$NC"
                echo -e "${YELLOW}Please install Java 17 manually from: https://adoptium.net/temurin/releases/${NC}"
                return 1
            fi
        else
            echo -e "${RED}❌ Unsupported Linux distribution. Please install Java 17 manually:${NC}"
            echo -e "${YELLOW}https://adoptium.net/temurin/releases/${NC}"
            return 1
        fi
    else
        echo -e "${RED}❌ Unsupported OS for automatic Java installation.${NC}"
        echo -e "${YELLOW}Please install Java 17 manually from: https://adoptium.net/temurin/releases/${NC}"
        return 1
    fi

    # Verify installation
    hash -r
    if command -v java &> /dev/null; then
        local new_version_output
        if new_version_output="$(java -version 2>&1)"; then
            if java_output_is_supported "$new_version_output"; then
                echo -e "${GREEN}✅ Java detected successfully: $(java_version_first_line "$new_version_output")${NC}"
                return 0
            fi
        fi
        echo -e "${YELLOW}Current shell still resolves: $(java_version_first_line "$new_version_output")${NC}"
    fi

    echo -e "${RED}❌ Java installation verification failed.${NC}"
    echo -e "${YELLOW}Please install Java 17 manually from: https://adoptium.net/temurin/releases/${NC}"
    return 1
}

# 3. Check Node.js >= 24
load_nvm() {
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    if [ -s "$NVM_DIR/nvm.sh" ]; then
        # shellcheck disable=SC1090
        . "$NVM_DIR/nvm.sh"
        return 0
    fi
    return 1
}

install_or_upgrade_node_with_nvm() {
    echo -e "${BLUE}Installing/upgrading Node.js via nvm...${NC}"

    if ! load_nvm; then
        if ! command -v curl &> /dev/null; then
            echo -e "${RED}❌ curl is required to install nvm automatically.${NC}"
            return 1
        fi

        # Verify the pinned installer before executing downloaded code.
        local nvm_installer nvm_digest
        nvm_installer="$(mktemp)" || return 1
        if ! curl --proto '=https' --tlsv1.2 -fsSL \
            https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh -o "$nvm_installer"; then
            rm -f "$nvm_installer"
            return 1
        fi
        if command -v sha256sum &> /dev/null; then
            nvm_digest="$(sha256sum "$nvm_installer")" || { rm -f "$nvm_installer"; return 1; }
        elif command -v shasum &> /dev/null; then
            nvm_digest="$(shasum -a 256 "$nvm_installer")" || { rm -f "$nvm_installer"; return 1; }
        else
            echo "A SHA-256 checksum tool is required to install nvm." >&2
            rm -f "$nvm_installer"
            return 1
        fi
        if [ "${nvm_digest%% *}" != "abdb525ee9f5b48b34d8ed9fc67c6013fb0f659712e401ecd88ab989b3af8f53" ]; then
            echo "nvm installer checksum mismatch; refusing to execute." >&2
            rm -f "$nvm_installer"
            return 1
        fi
        if ! bash "$nvm_installer"; then
            rm -f "$nvm_installer"
            return 1
        fi
        rm -f "$nvm_installer"
        if ! load_nvm; then
            echo -e "${RED}❌ nvm installation completed but nvm could not be loaded.${NC}"
            return 1
        fi
    fi

    nvm install 24
    nvm alias default 24
    nvm use 24 > /dev/null
    hash -r

    local NODE_VERSION
    NODE_VERSION="$(node -v | cut -d'v' -f2)"
    echo -e "${GREEN}✅ Node.js $NODE_VERSION installed via nvm.${NC}"
    return 0
}

check_node() {
    if ! command -v node &> /dev/null; then
        echo -e "${YELLOW}⚠️  Node.js not found. Installing Node.js >= 24 via nvm...${NC}"
        install_or_upgrade_node_with_nvm
        return $?
    fi

    local NODE_VERSION
    local MAJOR_VERSION
    NODE_VERSION=$(node -v | cut -d'v' -f2)
    MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d'.' -f1)

    if [ "$MAJOR_VERSION" -lt 24 ]; then
        echo -e "${YELLOW}⚠️  Node.js version $NODE_VERSION detected. Upgrading to Node.js >= 24 via nvm...${NC}"
        install_or_upgrade_node_with_nvm
        return $?
    fi

    echo -e "${GREEN}✅ Node.js $NODE_VERSION detected.${NC}"
    return 0
}

# 3. Check/Install adb
check_adb() {
    if command -v adb &> /dev/null; then
        echo -e "${GREEN}✅ adb detected: $(which adb)${NC}"
        return 0
    fi

    echo -e "${YELLOW}⚠️  adb not found. Attempting to install...${NC}"

    if [ "$OS" == "Darwin" ]; then
        if command -v brew &> /dev/null; then
            echo "Installing android-platform-tools via Homebrew..."
            brew install --cask android-platform-tools
        else
            echo -e "${RED}❌ Homebrew not found. Please install adb manually: https://developer.android.com/tools/releases/platform-tools${NC}"
            return 1
        fi
    elif [ "$OS" == "Linux" ]; then
        if command -v apt-get &> /dev/null; then
            echo "Installing android-tools-adb via apt..."
            sudo apt-get update && sudo apt-get install -y android-tools-adb android-tools-fastboot
        elif command -v pacman &> /dev/null; then
            echo "Installing android-tools via pacman..."
            sudo pacman -S --noconfirm android-tools
        else
            echo -e "${RED}❌ Unsupported Linux distribution. Please install adb manually.${NC}"
            return 1
        fi
    fi

    if command -v adb &> /dev/null; then
        echo -e "${GREEN}✅ adb installed successfully.${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to install adb automatically.${NC}"
        return 1
    fi
}

# 4. Check/Install git
check_git() {
    if command -v git &> /dev/null; then
        echo -e "${GREEN}✅ git detected.${NC}"
        return 0
    fi

    echo -e "${YELLOW}⚠️  git not found. Attempting to install...${NC}"

    if [ "$OS" == "Darwin" ]; then
        if command -v brew &> /dev/null; then
            echo "Installing git via Homebrew..."
            brew install git
        else
            echo -e "${RED}❌ Homebrew not found. Please install git manually (or install Xcode Command Line Tools).${NC}"
            return 1
        fi
    elif [ "$OS" == "Linux" ]; then
        if command -v apt-get &> /dev/null; then
            sudo apt-get update && sudo apt-get install -y git
        elif command -v pacman &> /dev/null; then
            sudo pacman -S --noconfirm git
        fi
    fi

    if command -v git &> /dev/null; then
        echo -e "${GREEN}✅ git installed successfully.${NC}"
        return 0
    else
        echo -e "${RED}❌ Failed to install git automatically.${NC}"
        return 1
    fi
}

# 5. Check download tool
check_curl() {
    if command -v curl &> /dev/null; then
        echo -e "${GREEN}✅ curl detected.${NC}"
        return 0
    fi

    echo -e "${RED}❌ curl is required for the Androperator installer bootstrap and recovery download hints.${NC}"
    return 1
}

# 6. Install Androperator CLI
install_cli() {
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ npm not found on PATH. Ensure Node.js is correctly installed.${NC}"
        return 1
    fi

    local NPM_PREFIX
    NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
    if [ -n "$NPM_PREFIX" ] && [ -f "$NPM_PREFIX/lib/node_modules/androperator/package.json" ]; then
        echo "Removing the former unscoped npm package to free the androperator executable..."
        npm uninstall -g androperator || return 1
    fi

    echo -e "${BLUE}Installing Androperator CLI (@latest)...${NC}"
    if npm install -g @androperator/cli@latest; then
        echo -e "${GREEN}✅ Androperator CLI installed.${NC}"

        hash -r

        # Discover the freshly installed binary path for immediate use. Prefer
        # the npm prefix over any older androperator that may still appear
        # earlier on PATH in the current shell.
        local NPM_ANDROPERATOR_BIN=""
        NPM_PREFIX="$(npm config get prefix 2>/dev/null || true)"
        if [ -n "$NPM_PREFIX" ] && [ -x "$NPM_PREFIX/bin/androperator" ]; then
            NPM_ANDROPERATOR_BIN="$NPM_PREFIX/bin/androperator"
        fi
        if [ -n "$NPM_ANDROPERATOR_BIN" ]; then
            ANDROPERATOR_BIN_PATH="$NPM_ANDROPERATOR_BIN"
        else
            ANDROPERATOR_BIN_PATH="$(command -v androperator || true)"
        fi
        export ANDROPERATOR_BIN_PATH
        if [ -z "$ANDROPERATOR_BIN_PATH" ]; then
            echo -e "${RED}❌ Androperator CLI installed but the binary could not be found on PATH.${NC}"
            echo -e "${YELLOW}Refresh your shell PATH and re-run:${NC}"
            echo -e "${YELLOW}${INSTALL_COMMAND}${NC}"
            return 1
        fi
    else
        echo -e "${RED}❌ Failed to install Androperator CLI. Try running 'sudo npm install -g @androperator/cli@latest' if permissions failed.${NC}"
        return 1
    fi
}

run_post_bootstrap_install() {
    local install_status=0

    if [ -z "${ANDROPERATOR_BIN_PATH:-}" ]; then
        echo -e "${RED}❌ Androperator CLI is required before post-bootstrap install can run.${NC}"
        return 1
    fi

    echo -e "${BLUE}Delegating post-bootstrap setup to 'androperator install'...${NC}"
    if "$ANDROPERATOR_BIN_PATH" install --output pretty --operator-package "$DEFAULT_OPERATOR_PACKAGE"; then
        return 0
    else
        install_status=$?
    fi

    return "$install_status"
}

resolve_source_command() {
    local ACTIVE_SHELL="${SHELL:-/bin/bash}"
    local DETECTED_SHELL
    DETECTED_SHELL="$(basename "$ACTIVE_SHELL")"

    case "$DETECTED_SHELL" in
        zsh)
            printf '%s\n' "source ~/.zshrc"
            ;;
        bash)
            if [ -f "$HOME/.bashrc" ]; then
                printf '%s\n' "source ~/.bashrc"
            else
                printf '%s\n' "source ~/.bash_profile"
            fi
            ;;
        *)
            printf '%s\n' "source ~/.$(basename "$ACTIVE_SHELL")rc"
            ;;
    esac
}

print_shell_activation_hint() {
    local SOURCE_CMD
    SOURCE_CMD="$(resolve_source_command)"

    echo ""
    echo -e "${YELLOW}Activate Androperator in your current terminal:${NC}"
    echo -e "${YELLOW}  ${SOURCE_CMD}${NC}"
    echo ""
    echo -e "Docs: ${BLUE}https://docs.androperator.com${NC}"
    echo -e "LLM guide: ${BLUE}https://docs.androperator.com/llms.txt${NC}"
}

show_star_hint() {
  # Skip if not a TTY
  [ -t 2 ] || return 0
  # Skip if suppressed via env var
  [ -n "${ANDROPERATOR_DISABLE_STAR_SUGGESTIONS:-}" ] && return 0
  cat >&2 <<'EOF'

Androperator is open source. If it helped, consider starring the repo:
https://github.com/androperator/androperator

GitHub CLI:
gh api -X PUT /user/starred/androperator/androperator -H "X-GitHub-Api-Version: 2026-03-10"

Disable this hint with: ANDROPERATOR_DISABLE_STAR_SUGGESTIONS=1

EOF
}

# Main
main() {
    local install_status=0

    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Androperator Installation Script${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}OS detected: $OS${NC}"
    validate_os || exit 1
    check_java || exit 1
    check_node || exit 1
    check_curl || exit 1
    check_adb || exit 1
    check_git || exit 1

    install_cli || exit 1

    if run_post_bootstrap_install; then
        :
    else
        install_status=$?
        trap - ERR
        return "$install_status"
    fi

    print_shell_activation_hint
    show_star_hint
}

if [[ "${BASH_SOURCE[0]-}" == "$0" || -z "${BASH_SOURCE[0]-}" ]]; then main "$@"; fi
