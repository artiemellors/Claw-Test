# nix/shell.nix
#
# Development shell for OpenClaw contributors.
# Provides Node 22, pnpm, linting tools, and a welcome banner.
#
{
  pkgs,
  lib,
  packagesModule,
  nodejs,
  pnpm,
}:

let
  asciiArt = import ./shell-functions/ascii-art.nix { };

  welcomeBanner = ''
    ${asciiArt}
    echo "Node.js: $(node --version)"
    echo "pnpm:    $(pnpm --version)"
    echo ""
    echo "Commands:"
    echo "  pnpm install     Install dependencies"
    echo "  pnpm build       Build the project"
    echo "  pnpm check       Lint + format + typecheck"
    echo "  pnpm test        Run tests"
    echo "  pnpm dev         Run CLI in dev mode"
    echo ""
    echo "Nix targets:"
    echo "  nix run .#with-ollama         Ollama + OpenClaw"
    echo "  nix run .#with-ollama-cuda    Ollama (NVIDIA) + OpenClaw"
    echo "  nix run .#with-ollama-rocm    Ollama (AMD) + OpenClaw"
    echo "  nix run .#with-ollama-vulkan  Ollama (Intel Arc / generic) + OpenClaw"
    echo "  nix flake check               Run all verification checks"
    echo ""
    echo "Docs: nix/README.md | https://docs.openclaw.ai"
    echo ""
  '';
in
pkgs.mkShell {
  name = "openclaw-dev";

  packages = packagesModule.allPackages;

  buildInputs = packagesModule.nativeDeps;

  env = {
    NODE_ENV = "development";
    RIPGREP_PATH = "${pkgs.ripgrep}/bin/rg";
  };

  shellHook = welcomeBanner;
}
