# nix/analysis/default.nix
#
# Combines all static analysis categories into a unified interface.
#
# Each category provides:
#   - packages: list of tools to add to the dev shell
#   - runner:   writeShellApplication that runs the category's checks
#
# Usage from flake.nix:
#   nix run .#analyze              Run all analysis
#   nix run .#analyze-nix          Nix linting only
#   nix run .#analyze-security     Security scanning only
#   nix run .#analyze-typescript   TS/JS linting only
#   nix run .#analyze-quality      Code quality only
#   nix run .#analyze-container    Dockerfile linting only
#   nix run .#analyze-docs         Documentation linting only
#   nix run .#analyze-supply-chain SBOM and license scanning only
#
{ pkgs, lib }:

let
  # Helper — wraps per-category check scripts in a standard runner shell
  # with FAILED tracking, section headers, and pass/fail summary.
  mkAnalysisRunner =
    {
      name,
      category,
      runtimeInputs,
      checks,
    }:
    pkgs.writeShellApplication {
      inherit name runtimeInputs;
      text = ''
        echo "==> ${category} Analysis"
        FAILED=0

        ${checks}

        if [ "$FAILED" -ne 0 ]; then
          echo ""
          echo "Some ${category} checks failed."
          exit 1
        fi
        echo ""
        echo "All ${category} checks passed."
      '';
    };

  # Import all analysis categories
  categories = {
    nix = import ./nix.nix { inherit pkgs mkAnalysisRunner; };
    typescript = import ./typescript.nix { inherit pkgs mkAnalysisRunner; };
    security = import ./security.nix { inherit pkgs mkAnalysisRunner; };
    quality = import ./code-quality.nix { inherit pkgs mkAnalysisRunner; };
    container = import ./container.nix { inherit pkgs mkAnalysisRunner; };
    docs = import ./docs.nix { inherit pkgs mkAnalysisRunner; };
    supply-chain = import ./supply-chain.nix { inherit pkgs mkAnalysisRunner; };
  };

  # Execution order for the combined runner
  categoryOrder = [
    "nix"
    "typescript"
    "security"
    "quality"
    "container"
    "docs"
    "supply-chain"
  ];

  # All packages from all categories (for the dev shell)
  allPackages = builtins.concatLists (lib.mapAttrsToList (_: cat: cat.packages) categories);

  # Generate the chained runner script from categoryOrder
  runAllScript = lib.concatMapStringsSep ''

    echo ""
    echo "--------------------------------------------"
  '' (name: "${lib.getExe categories.${name}.runner} || OVERALL=1") categoryOrder;

  # Combined runner that executes all categories
  allRunner = pkgs.writeShellApplication {
    name = "openclaw-analyze-all";
    runtimeInputs = builtins.concatLists (
      lib.mapAttrsToList (_: cat: cat.runner.runtimeInputs or [ ]) categories
    );
    text = ''
      echo "============================================"
      echo "  OpenClaw — Full Static Analysis Suite"
      echo "============================================"
      echo ""
      OVERALL=0

      echo ""
      ${runAllScript}

      echo ""
      echo "============================================"
      if [ "$OVERALL" -ne 0 ]; then
        echo "  Some analysis checks FAILED."
        exit 1
      fi
      echo "  All analysis checks PASSED."
      echo "============================================"
    '';
  };

in
{
  inherit categories allPackages allRunner;

  # Individual runners for flake apps — generated from categories
  runners = {
    analyze = allRunner;
  }
  // lib.mapAttrs' (name: cat: lib.nameValuePair "analyze-${name}" cat.runner) categories;
}
