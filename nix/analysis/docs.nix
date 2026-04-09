# nix/analysis/docs.nix
#
# Documentation linting and link checking tools.
#
# Tools:
#   markdownlint-cli2    - Markdown linter (style and correctness)
#   markdownlint-cli     - Classic markdown linter
#   markdown-link-check  - Checks for broken links in markdown files
#
{ pkgs, mkAnalysisRunner }:

{
  packages = [
    pkgs.markdownlint-cli2
    pkgs.markdownlint-cli
    pkgs.markdown-link-check
  ];

  runner = mkAnalysisRunner {
    name = "openclaw-analyze-docs";
    category = "Documentation";
    runtimeInputs = [
      pkgs.markdownlint-cli2
      pkgs.markdown-link-check
    ];
    checks = ''
      echo ""
      echo "--- markdownlint-cli2 (markdown style) ---"
      markdownlint-cli2 'docs/**/*.md' 'nix/**/*.md' '*.md' 2>/dev/null || FAILED=1

      echo ""
      echo "--- markdown-link-check (broken links) ---"
      find docs/ nix/ -name '*.md' -print0 2>/dev/null \
        | xargs -0 --no-run-if-empty -I{} \
          markdown-link-check --quiet {} || FAILED=1
    '';
  };
}
