#!/bin/bash

# https://stackoverflow.com/questions/2870992/automatic-exit-from-bash-shell-script-on-error
# https://stackoverflow.com/questions/821396/aborting-a-shell-script-if-any-command-returns-a-non-zero-value
set -e

set -x

cd "$(dirname "$0")"

cd ../../../

packageVersionWithQuotes=$(jq ".version" ./package.json)

# Update and add:
#     ./extension/manifest.json
echo "$( jq '.version = '$packageVersionWithQuotes'' ./extension/manifest.json --indent 4 )" > ./extension/manifest.json
git add ./extension/manifest.json
