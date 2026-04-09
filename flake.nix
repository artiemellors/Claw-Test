# OpenClaw Nix Flake
#
# Provides a reproducible development environment, one-command inference
# runners, OCI containers, and hardened MicroVMs for OpenClaw.
#
# Quick start:
#   nix develop                        Enter the dev shell
#   nix run .#with-ollama              Ollama + OpenClaw (auto-detect GPU)
#   nix run .#with-ollama-cuda         Ollama (NVIDIA) + OpenClaw
#   nix run .#with-ollama-rocm         Ollama (AMD) + OpenClaw
#   nix run .#with-ollama-vulkan       Ollama (Intel Arc / generic) + OpenClaw
#   nix run .#with-llama-cpp           llama.cpp server + OpenClaw
#   nix run .#with-llama-cpp-vulkan    llama.cpp (Intel Arc) + OpenClaw
#   nix run .#with-vllm               vLLM + OpenClaw
#   nix run .#analyze                  Run all static analysis
#   nix run .#analyze-security         Security scanning only
#   nix run .#analyze-nix              Nix linting only
#   nix flake check                    Run all verification checks
#   nix fmt                            Format all Nix files
#
# Containers (Linux only):
#   nix build .#openclaw-container && ./result | docker load
#   nix build .#openclaw-container-with-ollama && ./result | docker load
#
# MicroVMs (Linux only):
#   nix run .#openclaw-microvm                Start gateway VM
#   nix run .#openclaw-microvm-ollama         Start gateway + Ollama VM
#   socat -,rawer tcp:localhost:15501         Virtio console (gateway)
#   socat -,rawer tcp:localhost:15511         Virtio console (gateway-ollama)
#
# If flakes aren't enabled:
#   nix --extra-experimental-features 'nix-command flakes' develop
#
# See nix/README.md for full documentation.
#
{
  description = "OpenClaw — personal AI assistant on your own devices";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    microvm = {
      url = "github:astro/microvm.nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      microvm,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };
        inherit (pkgs) lib;

        isLinux = pkgs.stdenv.hostPlatform.isLinux;

        # --- Shared constants ---------------------------------------------------
        constants = import ./nix/constants.nix;

        # --- Pinned toolchain ---------------------------------------------------
        nodejs = pkgs.nodejs_22;
        inherit (pkgs) pnpm;

        # --- Source filter (for checks/builds) ----------------------------------
        src = import ./nix/source-filter.nix { inherit lib constants; };

        # --- Dev shell packages -------------------------------------------------
        packagesModule = import ./nix/packages.nix {
          inherit
            pkgs
            lib
            nodejs
            pnpm
            ;
        };

        # --- OpenClaw CLI (built from local source) -------------------------------
        openclaw = import ./nix/openclaw.nix {
          inherit
            pkgs
            lib
            src
            nodejs
            pnpm
            ;
        };

        # --- Inference engine lifecycle helpers ---------------------------------
        common = import ./nix/inference/common.nix;

        # --- Inference engines (parameterized by acceleration) ------------------
        mkOllama =
          acceleration:
          import ./nix/inference/ollama.nix {
            inherit
              pkgs
              lib
              constants
              acceleration
              ;
          };

        mkLlamaCpp =
          acceleration:
          import ./nix/inference/llama-cpp.nix {
            inherit
              pkgs
              lib
              constants
              acceleration
              ;
          };

        vllmEngine = import ./nix/inference/vllm.nix {
          inherit pkgs lib constants;
        };

        # --- Combined runners (inference + OpenClaw) ----------------------------
        mkOllamaRunner =
          acceleration:
          import ./nix/runners/with-ollama.nix {
            inherit
              pkgs
              lib
              common
              openclaw
              ;
            ollamaEngine = mkOllama acceleration;
          };

        mkLlamaCppRunner =
          acceleration:
          import ./nix/runners/with-llama-cpp.nix {
            inherit
              pkgs
              lib
              common
              openclaw
              ;
            llamaEngine = mkLlamaCpp acceleration;
          };

        vllmRunner = import ./nix/runners/with-vllm.nix {
          inherit
            pkgs
            lib
            common
            openclaw
            ;
          inherit vllmEngine;
        };

        # --- Static analysis suite -----------------------------------------------
        analysis = import ./nix/analysis { inherit pkgs lib; };

        # --- Optimized openclaw (stripped -dev closure) ---------------------------
        openclawSlim = import ./nix/containers/openclaw-slim.nix {
          inherit pkgs lib openclaw;
        };

        # --- OCI containers (Linux only) -----------------------------------------
        containers = lib.optionalAttrs isLinux (
          import ./nix/containers {
            inherit
              pkgs
              lib
              constants
              openclaw
              common
              openclawSlim
              ;
            ollamaPkg = (mkOllama null).pkg;
          }
        );

        # --- MicroVM builder (Linux only) ----------------------------------------
        mkMicrovm =
          variant:
          import ./nix/microvm/microvm.nix {
            inherit
              pkgs
              lib
              openclaw
              microvm
              nixpkgs
              system
              variant
              ;
            ollamaPkg = (mkOllama null).pkg;
          };

        vmConstants = import ./nix/microvm/constants.nix;

        # MicroVM output name: "gateway" → "openclaw-microvm", others → "openclaw-microvm-<suffix>"
        mkMicrovmName =
          name:
          "openclaw-microvm${lib.optionalString (name != "gateway") "-${lib.removePrefix "gateway-" name}"}";

      in
      {
        # --- Dev shells ---------------------------------------------------------
        devShells.default = import ./nix/shell.nix {
          inherit
            pkgs
            lib
            packagesModule
            nodejs
            pnpm
            ;
        };

        # Dev shell with all static analysis tools included
        devShells.analysis = pkgs.mkShell {
          name = "openclaw-analysis";
          packages = packagesModule.allPackages ++ analysis.allPackages;
          buildInputs = packagesModule.nativeDeps;
          env = {
            NODE_ENV = "development";
            RIPGREP_PATH = "${pkgs.ripgrep}/bin/rg";
          };
          shellHook = ''
            echo "OpenClaw Analysis Shell"
            echo ""
            echo "All 45 static analysis tools are available."
            echo ""
            echo "Run by category:"
            echo "  nix run .#analyze                All checks"
            echo "  nix run .#analyze-nix            Nix linting"
            echo "  nix run .#analyze-typescript     TS/JS linting"
            echo "  nix run .#analyze-security       Security scanning"
            echo "  nix run .#analyze-quality        Code quality"
            echo "  nix run .#analyze-container      Dockerfile linting"
            echo "  nix run .#analyze-docs           Documentation linting"
            echo "  nix run .#analyze-supply-chain   SBOM & license scanning"
            echo ""
          '';
        };

        # --- Formatter ----------------------------------------------------------
        formatter = pkgs.nixfmt-tree;

        # --- Packages (containers + microvm runners) ----------------------------
        packages =
          { }
          // containers
          // lib.optionalAttrs isLinux (
            lib.mapAttrs' (
              name: _: lib.nameValuePair (mkMicrovmName name) (mkMicrovm name)
            ) vmConstants.variants
          );

        # --- Apps (nix run) -----------------------------------------------------
        apps =
          let
            mkApp = drv: {
              type = "app";
              program = lib.getExe drv;
            };

            # Inference runner variants
            inferenceApps = lib.mapAttrs (_: mkApp) {
              with-ollama = mkOllamaRunner null;
              with-ollama-cuda = mkOllamaRunner "cuda";
              with-ollama-rocm = mkOllamaRunner "rocm";
              with-ollama-vulkan = mkOllamaRunner "vulkan";
              with-llama-cpp = mkLlamaCppRunner null;
              with-llama-cpp-vulkan = mkLlamaCppRunner "vulkan";
              with-vllm = vllmRunner;
            };

            # Static analysis runners (generated from analysis.runners)
            analysisApps = lib.mapAttrs (_: mkApp) analysis.runners;

            # MicroVM runner apps (Linux only)
            microvmApps = lib.optionalAttrs isLinux (
              lib.mapAttrs' (
                name: _: lib.nameValuePair (mkMicrovmName name) (mkApp (mkMicrovm name))
              ) vmConstants.variants
            );
          in
          inferenceApps
          // analysisApps
          // microvmApps
          // {
            openclaw = mkApp openclaw;

            update-deps = mkApp (
              pkgs.writeShellApplication {
                name = "openclaw-update-deps";
                runtimeInputs = [ ];
                text = ''
                  echo "==> Updating flake inputs (nixpkgs, flake-utils, microvm)..."
                  nix flake update

                  echo ""
                  echo "Done. Run 'nix fmt' to format, then commit flake.nix and flake.lock"
                '';
              }
            );
          }
          // lib.optionalAttrs isLinux {
            # Container size reporter — measures OCI image sizes without Docker
            container-size = mkApp (
              pkgs.writeShellApplication {
                name = "openclaw-container-size";
                runtimeInputs = [
                  pkgs.coreutils
                  pkgs.bc
                ];
                text = ''
                  format_size() {
                    local bytes=$1
                    if [ "$bytes" -ge 1073741824 ]; then
                      printf "%.1f GB" "$(echo "scale=2; $bytes / 1073741824" | bc)"
                    elif [ "$bytes" -ge 1048576 ]; then
                      printf "%.1f MB" "$(echo "scale=2; $bytes / 1048576" | bc)"
                    else
                      printf "%.1f KB" "$(echo "scale=2; $bytes / 1024" | bc)"
                    fi
                  }

                  measure_image() {
                    local name="$1" stream="$2"
                    echo "Building $name..."
                    UNCOMPRESSED=$("$stream" 2>/dev/null | wc -c)
                    COMPRESSED=$("$stream" 2>/dev/null | gzip -1 | wc -c)
                    UNCOMP_H=$(format_size "$UNCOMPRESSED")
                    COMP_H=$(format_size "$COMPRESSED")
                    echo "  Uncompressed: $UNCOMP_H"
                    echo "  Compressed:   $COMP_H"
                    echo ""
                  }

                  echo "============================================"
                  echo "  OpenClaw -- OCI Container Image Sizes"
                  echo "============================================"
                  echo ""
                  echo "No Docker or Podman required."
                  echo ""

                  measure_image "openclaw-container" "${containers.openclaw-container}"
                  measure_image "openclaw-container-with-ollama" "${containers.openclaw-container-with-ollama}"
                  ${lib.optionalString (containers ? openclaw-container-slim) ''
                    measure_image "openclaw-container-slim" "${containers.openclaw-container-slim}"
                  ''}

                  echo "============================================"
                  echo "  Docker Hub Baseline (for comparison)"
                  echo "============================================"
                  echo ""
                  echo "  node:22-slim (amd64):  ~76 MB compressed"
                  echo ""
                  echo "  Note: the nixpkgs openclaw package bundles ~1.9 GB"
                  echo "  of node_modules including build-time dependencies"
                  echo "  (@node-llama-cpp, @lancedb, typescript, rolldown,"
                  echo "  oxlint, etc). Fixing this requires upstream changes"
                  echo "  to the nixpkgs openclaw derivation."
                  echo ""

                  echo "============================================"
                  echo "  Nix Closure Analysis"
                  echo "============================================"
                  echo ""
                  echo "Closure contents (top 15 by size):"
                  nix path-info -rsSh ${openclaw} 2>/dev/null | sort -k2 -h | tail -15
                  echo ""
                  echo "Total closure size:"
                  nix path-info -sSh ${openclaw} 2>/dev/null
                  echo "============================================"
                '';
              }
            );
          };

        # --- Checks (nix flake check) ------------------------------------------
        checks =
          let
            checksModule = import ./nix/checks.nix {
              inherit
                pkgs
                lib
                src
                nodejs
                pnpm
                ;
              pnpmDeps = null; # TODO: add fetchPnpmDeps when ready
            };
          in
          {
            inherit (checksModule) check-format;
            # Uncomment when pnpmDeps hash is configured:
            # inherit (checksModule) check-lint check-test;
            shell = self.devShells.${system}.default;
          };
      }
    );
}
