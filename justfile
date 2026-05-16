set shell := ["bash", "-euo", "pipefail", "-c"]

# Show available recipes.
default:
    @just --list

# Run the test suite.
test:
    npm test

# Initialize this checkout for direct Pi agent-home use.
init-agent-home:
    ./scripts/init-agent-home.sh

# Launch pi with this checkout as PI_CODING_AGENT_DIR.
pi-home *args:
    ./scripts/pi-home.sh {{args}}

# Benchmark pi extension startup overhead.
benchmark *args:
    node scripts/pi-extension-startup-benchmark.mjs {{args}}
