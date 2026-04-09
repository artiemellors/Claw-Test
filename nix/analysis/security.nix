# nix/analysis/security.nix
#
# Security scanning and vulnerability detection tools.
#
# Tools:
#   trivy       - Comprehensive vulnerability scanner (fs, container, SBOM)
#   grype       - Vulnerability scanner for container images and filesystems
#   syft        - SBOM generator (also used by supply-chain.nix)
#   semgrep     - Static analysis with pattern matching
#   gitleaks    - Secret detection in git history
#   trufflehog  - Secret detection across git, S3, filesystems
#
{ pkgs, mkAnalysisRunner }:

{
  packages = [
    pkgs.trivy
    pkgs.grype
    pkgs.syft
    pkgs.semgrep
    pkgs.gitleaks
    pkgs.trufflehog
  ];

  runner = mkAnalysisRunner {
    name = "openclaw-analyze-security";
    category = "Security";
    runtimeInputs = [
      pkgs.trivy
      pkgs.grype
      pkgs.gitleaks
      pkgs.trufflehog
    ];
    checks = ''
      echo ""
      echo "--- trivy (vulnerability scan) ---"
      trivy fs --scanners vuln,secret,misconfig . || FAILED=1

      echo ""
      echo "--- gitleaks (secret detection in git) ---"
      gitleaks detect --source . --no-banner || FAILED=1

      echo ""
      echo "--- trufflehog (secret detection) ---"
      trufflehog filesystem . --no-update --only-verified 2>/dev/null || FAILED=1

      echo ""
      echo "--- grype (dependency vulnerabilities) ---"
      if [ -f "pnpm-lock.yaml" ]; then
        grype dir:. --only-fixed || FAILED=1
      else
        echo "(skipped: no pnpm-lock.yaml)"
      fi
    '';
  };
}
