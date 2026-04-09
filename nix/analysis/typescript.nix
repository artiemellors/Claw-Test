# nix/analysis/typescript.nix
#
# TypeScript and JavaScript linting and analysis tools.
#
# Tools:
#   oxlint    - Fast Rust-based linter (used by the project)
#   biome     - Fast formatter/linter (alternative perspective)
#   eslint    - Traditional JS/TS linter
#   eslint_d  - eslint daemon for faster repeated runs
#
{ pkgs, mkAnalysisRunner }:

{
  packages = [
    pkgs.oxlint
    pkgs.biome
    pkgs.eslint
    pkgs.eslint_d
  ];

  runner = mkAnalysisRunner {
    name = "openclaw-analyze-typescript";
    category = "TypeScript / JavaScript";
    runtimeInputs = [
      pkgs.oxlint
      pkgs.biome
    ];
    checks = ''
      echo ""
      echo "--- oxlint (primary linter) ---"
      if [ -f ".oxlintrc.json" ]; then
        oxlint -c .oxlintrc.json src/ || FAILED=1
      else
        oxlint src/ || FAILED=1
      fi

      echo ""
      echo "--- biome (supplementary analysis) ---"
      biome check --no-errors-on-unmatched src/ 2>/dev/null \
        || echo "(biome: no config found, skipped)"
    '';
  };
}
