# nix/inference/llama-cpp.nix
#
# llama.cpp server inference engine module.
# Parameterized by GPU acceleration backend.
#
# Acceleration options:
#   null     - auto-detect / CPU fallback
#   "rocm"   - AMD GPU (ROCm)
#   "vulkan" - Intel Arc / generic GPU (Vulkan)
#
# Note: CUDA support uses the base package with cudaSupport from nixpkgs config.
# Note: macOS Metal is auto-enabled on Apple Silicon via the base package.
#
{
  pkgs,
  lib,
  constants,
  acceleration ? null,
}:

let
  accelPkgs = {
    rocm = pkgs.llama-cpp-rocm;
    vulkan = pkgs.llama-cpp-vulkan;
  };

  accelLabels = {
    rocm = "AMD ROCm";
    vulkan = "Vulkan (Intel Arc / generic)";
  };

  validAccelerations = [ null ] ++ builtins.attrNames accelPkgs;
in
assert lib.assertMsg (builtins.elem acceleration validAccelerations)
  "llama-cpp: invalid acceleration '${toString acceleration}'. Valid: ${toString validAccelerations}";
let
  pkg = if acceleration == null then pkgs.llama-cpp else accelPkgs.${acceleration};
  accelLabel =
    if acceleration == null then "CPU (auto-detect / Metal on macOS)" else accelLabels.${acceleration};
  port = constants.ports.llama-cpp;
in
{
  inherit pkg port accelLabel;
  healthUrl = "http://127.0.0.1:${port}${constants.healthEndpoints.llama-cpp}";
  engineName = "llama.cpp";
  timeout = constants.healthTimeouts.llama-cpp;

  startScript = ''
    echo "Starting llama.cpp server on port ${port}..."
    echo "Note: pass a model with --model <path-to-gguf>"
    ${pkg}/bin/llama-server \
      --host 127.0.0.1 \
      --port ${port} \
      "$@" &
    SERVER_PID=$!
  '';
}
