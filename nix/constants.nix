# nix/constants.nix
#
# Shared project metadata and version constants.
# Pure data — no pkgs dependency.
#
{
  pname = "openclaw";
  description = "OpenClaw — personal AI assistant on your own devices";
  homepage = "https://openclaw.ai";
  repo = "https://github.com/openclaw/openclaw";
  docs = "https://docs.openclaw.ai";
  license = "mit";

  # Minimum Node.js major version (matches package.json engines.node)
  nodeMajor = 22;

  # Default ports for inference engines
  ports = {
    ollama = "11434";
    llama-cpp = "8080";
    vllm = "8000";
    openclaw-gateway = "18789";
  };

  # Health-check endpoints
  healthEndpoints = {
    ollama = "/api/tags";
    llama-cpp = "/health";
    vllm = "/health";
  };

  # Health-check timeouts (seconds) — higher for slower-starting engines
  healthTimeouts = {
    ollama = "30";
    llama-cpp = "60";
    vllm = "120";
  };

  # Container image defaults
  container = {
    user = "openclaw";
    uid = 990;
    gid = 990;
  };

  # MicroVM defaults
  microvm = {
    ram = 1024;
    vcpus = 4;
    consolePortBase = 15500;
    sshPassword = "openclaw"; # debug/lifecycle testing only
    portOffsets = {
      gateway = 0;
      gateway-ollama = 100;
    };
  };

  # Paths excluded from Nix store copies
  ignoredPaths = [
    ".direnv"
    ".git"
    "result"
    "result-dev"
    "node_modules"
    "dist"
    ".turbo"
    ".vscode"
    ".cursor"
  ];
}
