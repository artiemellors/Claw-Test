# nix/analysis/code-quality.nix
#
# General code quality and hygiene tools.
#
# Tools:
#   shellcheck   - Static analysis for shell scripts
#   shfmt        - Shell script formatter
#   actionlint   - GitHub Actions workflow linter
#   typos        - Source code spell checker (fast, low false positives)
#   typos-lsp    - LSP server for typos
#   codespell    - Source code spell checker (Python-based)
#   vale         - Prose linter for docs
#   vale-ls      - LSP server for vale
#
{ pkgs, mkAnalysisRunner }:

{
  packages = [
    pkgs.shellcheck
    pkgs.shfmt
    pkgs.actionlint
    pkgs.typos
    pkgs.typos-lsp
    pkgs.codespell
    pkgs.vale
    pkgs.vale-ls
  ];

  runner = mkAnalysisRunner {
    name = "openclaw-analyze-code-quality";
    category = "Code Quality";
    runtimeInputs = [
      pkgs.shellcheck
      pkgs.shfmt
      pkgs.actionlint
      pkgs.typos
      pkgs.codespell
    ];
    checks = ''
      echo ""
      echo "--- shellcheck (shell script analysis) ---"
      find scripts/ git-hooks/ -name '*.sh' -print0 2>/dev/null \
        | xargs -0 --no-run-if-empty shellcheck || FAILED=1

      echo ""
      echo "--- shfmt (shell formatting check) ---"
      find scripts/ git-hooks/ -name '*.sh' -print0 2>/dev/null \
        | xargs -0 --no-run-if-empty shfmt -d || FAILED=1

      echo ""
      echo "--- actionlint (GitHub Actions) ---"
      if [ -d ".github/workflows" ]; then
        actionlint || FAILED=1
      else
        echo "(skipped: no .github/workflows/)"
      fi

      echo ""
      echo "--- typos (spell check) ---"
      typos --format brief src/ docs/ scripts/ || FAILED=1

      echo ""
      echo "--- codespell (spell check) ---"
      codespell --quiet-level=2 --skip='*.lock,node_modules,dist,.git,*.svg' \
        src/ docs/ scripts/ 2>/dev/null || FAILED=1
    '';
  };
}
