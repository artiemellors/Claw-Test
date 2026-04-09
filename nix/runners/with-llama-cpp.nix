# nix/runners/with-llama-cpp.nix
#
# Combined runner: starts llama.cpp server, waits for readiness, launches OpenClaw.
# Parameterized by acceleration (rocm, vulkan, or null).
#
# Usage from flake.nix:
#   nix run .#with-llama-cpp
#   nix run .#with-llama-cpp-vulkan
#
# Pass model path after --:
#   nix run .#with-llama-cpp -- --model ./my-model.gguf
#
{
  pkgs,
  lib,
  common,
  llamaEngine,
  openclaw,
}:

pkgs.writeShellApplication {
  name = "openclaw-with-llama-cpp";
  runtimeInputs = [
    llamaEngine.pkg
    openclaw
    pkgs.curl
  ];
  text = ''
    ${common.banner}
    ${common.healthCheck}
    ${common.cleanup}

    print_banner "${llamaEngine.engineName}" "${llamaEngine.accelLabel}"

    # Separate llama-server args (before --) from openclaw args (after --)
    ${common.splitArgs "LLAMA"}

    echo "Starting llama.cpp server on port ${llamaEngine.port}..."
    ${llamaEngine.pkg}/bin/llama-server \
      --host 127.0.0.1 \
      --port ${llamaEngine.port} \
      "''${LLAMA_ARGS[@]}" &
    SERVER_PID=$!
    trap 'cleanup_server $SERVER_PID "${llamaEngine.engineName}"' EXIT

    wait_for_server "${llamaEngine.healthUrl}" ${llamaEngine.timeout} "${llamaEngine.engineName}"

    echo "Starting OpenClaw (connected to llama.cpp at 127.0.0.1:${llamaEngine.port})..."
    echo ""
    ${lib.getExe openclaw} "''${OPENCLAW_ARGS[@]}"
  '';
}
