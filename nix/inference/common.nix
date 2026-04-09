# nix/inference/common.nix
#
# Shared lifecycle functions for inference engine runners.
# Provides health-check polling, graceful cleanup, and signal trapping.
#
# Used by all nix/runners/with-*.nix modules and nix/containers/default.nix.
#

{
  # Constructs a health-check URL from constants.
  mkHealthUrl =
    constants: engine:
    "http://127.0.0.1:${constants.ports.${engine}}${constants.healthEndpoints.${engine}}";

  healthCheck = ''
    wait_for_server() {
      local url="$1" timeout="$2" name="$3" elapsed=0
      printf "Waiting for %s to be ready" "$name"
      while ! curl -sf "$url" >/dev/null 2>&1; do
        sleep 1
        elapsed=$((elapsed + 1))
        printf "."
        if [ "$elapsed" -ge "$timeout" ]; then
          echo ""
          echo "ERROR: $name failed to start within ''${timeout}s"
          echo "Check logs above for details."
          exit 1
        fi
      done
      echo " ready."
    }
  '';

  cleanup = ''
    cleanup_server() {
      local pid="$1" name="$2"
      if kill -0 "$pid" 2>/dev/null; then
        echo "Stopping $name (PID $pid)..."
        kill "$pid" 2>/dev/null
        wait "$pid" 2>/dev/null || true
      fi
    }
  '';

  banner = ''
    print_banner() {
      local engine="$1" accel="$2"
      echo ""
      echo "OpenClaw + $engine ($accel)"
      echo "==========================================="
      echo ""
    }
  '';

  # Splits "$@" by "--" into ENGINE_ARGS (before) and OPENCLAW_ARGS (after).
  # engineVar: variable name prefix for the engine args array (e.g. "LLAMA" → LLAMA_ARGS).
  splitArgs = engineVar: ''
    ${engineVar}_ARGS=()
    OPENCLAW_ARGS=()
    found_separator=false
    for arg in "$@"; do
      if [ "$arg" = "--" ]; then
        found_separator=true
        continue
      fi
      if $found_separator; then
        OPENCLAW_ARGS+=("$arg")
      else
        ${engineVar}_ARGS+=("$arg")
      fi
    done
  '';
}
