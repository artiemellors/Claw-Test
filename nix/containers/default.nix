# nix/containers/default.nix
#
# OCI container images for OpenClaw.
#
# Each image uses streamLayeredImage — the derivation output is an
# executable script that streams a Docker-compatible tarball to stdout.
#
# Usage:
#   nix build .#openclaw-container && ./result | docker load
#   nix build .#openclaw-container && ./result | podman load
#
# With Ollama:
#   nix build .#openclaw-container-with-ollama && ./result | docker load
#   docker run -p 18789:18789 openclaw-with-ollama:latest
#
{
  pkgs,
  lib,
  constants,
  openclaw,
  ollamaPkg,
  common,
  openclawSlim ? null,
}:

let
  # Shared base contents for all containers
  baseContents = [
    pkgs.cacert # TLS CA certificates
    pkgs.tzdata # timezone data for log timestamps
  ];

  # Non-root user via embedded passwd/group files.
  # streamLayeredImage has no fakeRootCommands, so we embed the files directly.
  passwdFile = pkgs.writeTextDir "etc/passwd" ''
    root:x:0:0:root:/root:/bin/false
    ${constants.container.user}:x:${toString constants.container.uid}:${toString constants.container.gid}:OpenClaw service user:/var/lib/openclaw:/bin/false
    nobody:x:65534:65534:nobody:/nonexistent:/bin/false
  '';
  groupFile = pkgs.writeTextDir "etc/group" ''
    root:x:0:
    ${constants.container.user}:x:${toString constants.container.gid}:
    nogroup:x:65534:
  '';
  userContents = [
    passwdFile
    groupFile
  ];

  # Helper — builds a streamLayeredImage with standard defaults.
  # Returns the derivation with an extra `inputsHash` attribute so tests
  # can skip `docker load` when the image hasn't changed.
  mkContainer =
    {
      name,
      contents,
      port ? null,
      entrypoint,
      env ? [ ],
      extraConfig ? { },
    }:
    let
      allContents = contents ++ baseContents ++ userContents;
      inputsHash = builtins.substring 0 32 (
        builtins.hashString "sha256" (
          builtins.concatStringsSep ":" (
            (map (p: p.outPath) allContents)
            ++ [
              (builtins.toJSON entrypoint)
              (builtins.toJSON env)
              (builtins.toJSON extraConfig)
            ]
          )
        )
      );
      imageTag = openclaw.version or "latest";
      image = pkgs.dockerTools.streamLayeredImage ({
        inherit name;
        tag = imageTag;
        contents = allContents;

        config = {
          Entrypoint = entrypoint;
          User = "${toString constants.container.uid}:${toString constants.container.gid}";
          Env = [
            "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            "TZDIR=${pkgs.tzdata}/share/zoneinfo"
            "NODE_ENV=production"
            "HOME=/var/lib/openclaw"
          ]
          ++ env;
          Labels = {
            "nix.inputs.hash" = inputsHash;
            "org.opencontainers.image.title" = name;
            "org.opencontainers.image.source" = constants.repo;
          };
        }
        // (
          if port != null then
            {
              ExposedPorts = {
                "${toString port}/tcp" = { };
              };
            }
          else
            { }
        )
        // extraConfig;
      });
    in
    image // { inherit inputsHash imageTag; };

  # Wrapper script for the ollama+openclaw container.
  # Starts ollama in background, waits for health, then runs openclaw.
  ollamaHealthUrl = common.mkHealthUrl constants "ollama";

  ollamaWrapper = pkgs.writeShellScript "openclaw-with-ollama-entrypoint" ''
    ${common.healthCheck}
    ${common.cleanup}

    export OLLAMA_HOST="127.0.0.1:${constants.ports.ollama}"

    echo "Starting Ollama on port ${constants.ports.ollama}..."
    ${lib.getExe ollamaPkg} serve &
    SERVER_PID=$!
    trap 'cleanup_server $SERVER_PID "Ollama"' EXIT

    wait_for_server "${ollamaHealthUrl}" ${constants.healthTimeouts.ollama} "Ollama"

    echo "Starting OpenClaw gateway on port ${constants.ports.openclaw-gateway}..."
    exec ${openclaw}/bin/openclaw gateway run --bind 0.0.0.0 --port ${constants.ports.openclaw-gateway} "$@"
  '';

in
{
  # Standalone OpenClaw gateway container
  openclaw-container = mkContainer {
    name = "openclaw";
    contents = [ openclaw ];
    port = lib.toInt constants.ports.openclaw-gateway;
    entrypoint = [
      "${openclaw}/bin/openclaw"
      "gateway"
      "run"
      "--bind"
      "0.0.0.0"
      "--port"
      constants.ports.openclaw-gateway
    ];
  };

  # OpenClaw + Ollama all-in-one container
  openclaw-container-with-ollama = mkContainer {
    name = "openclaw-with-ollama";
    contents = [
      openclaw
      ollamaPkg
      pkgs.curl # for health checks
    ];
    port = lib.toInt constants.ports.openclaw-gateway;
    entrypoint = [ "${ollamaWrapper}" ];
  };
}
// lib.optionalAttrs (openclawSlim != null) {
  # Slim variant — strips -dev headers and build tools from nodejs closure.
  # See openclaw-slim.nix for what is removed and why.
  #
  # Current savings are modest (~65 MB uncompressed / ~18 MB compressed)
  # because the dominant cost is node_modules inside the nixpkgs openclaw
  # package (~1.9 GB), which includes build-time deps like @node-llama-cpp,
  # @lancedb, typescript, rolldown, and oxlint.
  #
  # Real optimization requires fixing the nixpkgs openclaw package to
  # separate build-time and runtime dependencies (npm install --omit=dev).

  openclaw-container-slim = mkContainer {
    name = "openclaw-slim";
    contents = [
      openclawSlim.openclaw-slim
      openclawSlim.nodejs-slim-stripped
    ];
    port = lib.toInt constants.ports.openclaw-gateway;
    entrypoint = [
      "${openclawSlim.openclaw-slim}/bin/openclaw"
      "gateway"
      "run"
      "--bind"
      "0.0.0.0"
      "--port"
      constants.ports.openclaw-gateway
    ];
  };
}
