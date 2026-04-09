# nix/runners/with-ollama.nix
#
# Combined runner: starts Ollama, waits for readiness, launches OpenClaw.
# Parameterized by acceleration (cuda, rocm, vulkan, or null).
#
# Usage from flake.nix:
#   nix run .#with-ollama
#   nix run .#with-ollama-cuda
#   nix run .#with-ollama-rocm
#   nix run .#with-ollama-vulkan
#
{
  pkgs,
  lib,
  common,
  ollamaEngine,
  openclaw,
}:

pkgs.writeShellApplication {
  name = "openclaw-with-ollama";
  runtimeInputs = [
    ollamaEngine.pkg
    openclaw
    pkgs.curl
  ];
  text = ''
    ${common.banner}
    ${common.healthCheck}
    ${common.cleanup}

    print_banner "${ollamaEngine.engineName}" "${ollamaEngine.accelLabel}"

    ${ollamaEngine.startScript}
    trap 'cleanup_server $SERVER_PID "${ollamaEngine.engineName}"' EXIT

    wait_for_server "${ollamaEngine.healthUrl}" ${ollamaEngine.timeout} "${ollamaEngine.engineName}"

    echo "Starting OpenClaw (connected to Ollama at 127.0.0.1:${ollamaEngine.port})..."
    echo ""
    ${lib.getExe openclaw} "$@"
  '';
}
