# nix/inference/ollama.nix
#
# Ollama inference engine module.
# Parameterized by GPU acceleration backend.
#
# Acceleration options:
#   null     - auto-detect / CPU fallback
#   "cuda"   - NVIDIA GPU (CUDA)
#   "rocm"   - AMD GPU (ROCm)
#   "vulkan" - Intel Arc / generic GPU (Vulkan)
#
{
  pkgs,
  lib,
  constants,
  acceleration ? null,
}:

let
  accelPkgs = {
    cuda = pkgs.ollama-cuda;
    rocm = pkgs.ollama-rocm;
    vulkan = pkgs.ollama-vulkan;
  };

  accelLabels = {
    cuda = "NVIDIA CUDA";
    rocm = "AMD ROCm";
    vulkan = "Vulkan (Intel Arc / generic)";
  };

  validAccelerations = [ null ] ++ builtins.attrNames accelPkgs;
in
assert lib.assertMsg (builtins.elem acceleration validAccelerations)
  "ollama: invalid acceleration '${toString acceleration}'. Valid: ${toString validAccelerations}";
let
  port = constants.ports.ollama;
in
let
  pkg = if acceleration == null then pkgs.ollama else accelPkgs.${acceleration};
  accelLabel = if acceleration == null then "CPU (auto-detect)" else accelLabels.${acceleration};
in
{
  inherit pkg port accelLabel;
  healthUrl = "http://127.0.0.1:${port}${constants.healthEndpoints.ollama}";
  engineName = "Ollama";
  timeout = constants.healthTimeouts.ollama;

  startScript = ''
    export OLLAMA_HOST="127.0.0.1:${port}"
    ${lib.getExe pkg} serve &
    SERVER_PID=$!
  '';
}
