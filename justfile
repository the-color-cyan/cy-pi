set shell := ["bash", "-euo", "pipefail", "-c"]

# Show available recipes.
default:
    @just --list

# Run the test suite.
test:
    bash tests/pi-dev.test.sh

# Copy pi package sources from settings into packages.example.json.
copy-packages source_settings="" packages_output="":
    ./scripts/copy-packages.sh {{source_settings}} {{packages_output}}

# Install pi package sources from packages.example.json, another packages JSON, or settings JSON.
install-packages input="":
    ./scripts/install-packages.sh {{input}}

# Link this checkout's local pi resources into ~/.pi/agent.
install-local-links *args:
    ./scripts/install-local-links.sh {{args}}

# Replace cy-pi package entries in pi settings with a local path to this checkout.
use-local-package:
    ./scripts/use-local-package.sh

# Launch or refresh an isolated pi dev home at ~/.pi-dev/agent.
pi-dev *args:
    ./scripts/pi-dev.sh {{args}}

# Benchmark pi extension startup overhead.
benchmark *args:
    node scripts/pi-extension-startup-benchmark.mjs {{args}}
