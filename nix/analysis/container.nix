# nix/analysis/container.nix
#
# Docker and container linting tools.
#
# Tools:
#   hadolint  - Dockerfile linter (best practices)
#   dockle    - Container image security linter
#
{ pkgs, mkAnalysisRunner }:

{
  packages = [
    pkgs.hadolint
    pkgs.dockle
  ];

  runner = mkAnalysisRunner {
    name = "openclaw-analyze-container";
    category = "Container";
    runtimeInputs = [
      pkgs.hadolint
    ];
    checks = ''
      echo ""
      echo "--- hadolint (Dockerfile linting) ---"
      found=0
      for f in Dockerfile Dockerfile.*; do
        if [ -f "$f" ]; then
          echo "  Checking $f"
          hadolint "$f" || FAILED=1
          found=1
        fi
      done
      if [ "$found" -eq 0 ]; then
        echo "(skipped: no Dockerfiles found)"
      fi
    '';
  };
}
