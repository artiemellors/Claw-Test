# nix/inference/vllm.nix
#
# vLLM inference engine module.
# GPU acceleration is inherited from the torch/vllm package configuration.
#
# Note: vLLM requires NVIDIA CUDA or AMD ROCm; no Vulkan/CPU-only mode.
# Intel Arc is not yet supported by vLLM in nixpkgs.
#
{
  pkgs,
  lib,
  constants,
}:

let
  port = constants.ports.vllm;
in
{
  pkg = pkgs.vllm;
  inherit port;
  healthUrl = "http://127.0.0.1:${port}${constants.healthEndpoints.vllm}";
  engineName = "vLLM";
  accelLabel = "GPU (via PyTorch)";
  timeout = constants.healthTimeouts.vllm;

  startScript = ''
    echo "Starting vLLM server on port ${port}..."
    echo "Note: pass a model with --model <model-name>"
    ${lib.getExe pkgs.vllm} serve \
      --host 127.0.0.1 \
      --port ${port} \
      "$@" &
    SERVER_PID=$!
  '';
}
