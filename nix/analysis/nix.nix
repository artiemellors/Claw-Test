# nix/analysis/nix.nix
#
# Nix-specific linting and static analysis tools.
#
# Tools:
#   statix    - Lints and suggests improvements for Nix code
#   deadnix   - Finds unused code in Nix files
#   nixfmt    - Formatter (also in dev shell)
#   nil       - Nix LSP (also in dev shell)
#
{ pkgs, mkAnalysisRunner }:

{
  packages = [
    pkgs.statix
    pkgs.deadnix
    pkgs.nixfmt
    pkgs.nil
  ];

  runner = mkAnalysisRunner {
    name = "openclaw-analyze-nix";
    category = "Nix";
    runtimeInputs = [
      pkgs.statix
      pkgs.deadnix
      pkgs.nixfmt
    ];
    checks = ''
      echo ""
      echo "--- statix (Nix linting) ---"
      statix check flake.nix || FAILED=1
      statix check nix/ || FAILED=1

      echo ""
      echo "--- deadnix (unused Nix code) ---"
      deadnix --no-lambda-pattern-names flake.nix nix/ || FAILED=1

      echo ""
      echo "--- nixfmt (formatting) ---"
      nixfmt --check flake.nix nix/ || FAILED=1
    '';
  };
}
