# nix/runners/with-vllm.nix
#
# Combined runner: starts vLLM server, waits for readiness, launches OpenClaw.
#
# Usage from flake.nix:
#   nix run .#with-vllm -- --model meta-llama/Llama-3-8B
#
# Pass vLLM args before -- and openclaw args after --:
#   nix run .#with-vllm -- --model meta-llama/Llama-3-8B -- gateway run
#
{
  pkgs,
  lib,
  common,
  vllmEngine,
  openclaw,
}:

pkgs.writeShellApplication {
  name = "openclaw-with-vllm";
  runtimeInputs = [
    vllmEngine.pkg
    openclaw
    pkgs.curl
  ];
  text = ''
    ${common.banner}
    ${common.healthCheck}
    ${common.cleanup}

    print_banner "${vllmEngine.engineName}" "${vllmEngine.accelLabel}"

    # Separate vllm args (before --) from openclaw args (after --)
    ${common.splitArgs "VLLM"}

    echo "Starting vLLM server on port ${vllmEngine.port}..."
    ${lib.getExe vllmEngine.pkg} serve \
      --host 127.0.0.1 \
      --port ${vllmEngine.port} \
      "''${VLLM_ARGS[@]}" &
    SERVER_PID=$!
    trap 'cleanup_server $SERVER_PID "${vllmEngine.engineName}"' EXIT

    wait_for_server "${vllmEngine.healthUrl}" ${vllmEngine.timeout} "${vllmEngine.engineName}"

    echo "Starting OpenClaw (connected to vLLM at 127.0.0.1:${vllmEngine.port})..."
    echo ""
    ${lib.getExe openclaw} "''${OPENCLAW_ARGS[@]}"
  '';
}
