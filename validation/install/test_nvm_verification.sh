#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test_dir="$(mktemp -d)"
trap 'rm -rf "$test_dir"' EXIT
mkdir -p "$test_dir/bin" "$test_dir/downloads"
cat > "$test_dir/bin/curl" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
[[ "${DOWNLOAD_FAIL:-0}" == 0 ]] || exit 22
while [[ "$1" != '-o' ]]; do shift; done
cp "$NVM_FIXTURE" "$2"
MOCK
cat > "$test_dir/bin/sha256sum" <<'MOCK'
#!/usr/bin/env bash
printf '%s  %s\n' "$NVM_TEST_DIGEST" "$1"
MOCK
chmod +x "$test_dir/bin/"*
printf 'touch "$NVM_EXECUTED"\nexit "${INSTALL_FAIL:-0}"\n' > "$test_dir/fixture.sh"
export PATH="$test_dir/bin:$PATH" TMPDIR="$test_dir/downloads" NVM_FIXTURE="$test_dir/fixture.sh"
for installer in sites/androperator-public/install.sh; do
    for scenario in valid mismatch download-failure execution-failure; do
        export NVM_EXECUTED="$test_dir/executed" DOWNLOAD_FAIL=0 INSTALL_FAIL=0
        export NVM_TEST_DIGEST=abdb525ee9f5b48b34d8ed9fc67c6013fb0f659712e401ecd88ab989b3af8f53
        rm -f "$NVM_EXECUTED"
        case "$scenario" in
            mismatch) NVM_TEST_DIGEST=invalid ;;
            download-failure) DOWNLOAD_FAIL=1 ;;
            execution-failure) INSTALL_FAIL=1 ;;
        esac
        status=0
        bash -c '
            source "$1"
            load_nvm() { [[ -f "$NVM_EXECUTED" ]]; }
            nvm() { :; }
            install_or_upgrade_node_with_nvm
        ' fixture "$installer" > "$test_dir/output" 2>&1 || status=$?
        if [[ "$scenario" == valid ]]; then
            [[ "$status" == 0 && -f "$NVM_EXECUTED" ]]
        else
            [[ "$status" != 0 ]]
            if [[ "$scenario" != execution-failure ]]; then [[ ! -f "$NVM_EXECUTED" ]]; fi
        fi
        [[ -z "$(ls -A "$test_dir/downloads")" ]]
    done
done
printf 'nvm verification: valid, mismatch, download failure, execution failure, and cleanup passed for the Androperator installer.\n'
