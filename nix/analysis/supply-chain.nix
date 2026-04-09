# nix/analysis/supply-chain.nix
#
# Supply chain security, license compliance, and dependency analysis tools.
#
# Tools:
#   syft               - SBOM generator (CycloneDX, SPDX)
#   cosign             - Container/artifact signing and verification
#   licensee           - License detection and compliance
#   license-scanner    - Scans dependencies for license info
#   npm-check-updates  - Interactive npm dependency updater
#
{ pkgs, mkAnalysisRunner }:

{
  packages = [
    pkgs.syft
    pkgs.cosign
    pkgs.licensee
    pkgs.license-scanner
    pkgs.npm-check-updates
  ];

  runner = mkAnalysisRunner {
    name = "openclaw-analyze-supply-chain";
    category = "Supply Chain";
    runtimeInputs = [
      pkgs.syft
      pkgs.license-scanner
    ];
    checks = ''
      echo ""
      echo "--- syft (SBOM generation) ---"
      syft dir:. --output table 2>/dev/null | head -50 || FAILED=1
      echo "  (showing first 50 entries; full SBOM: syft dir:. -o cyclonedx-json)"

      echo ""
      echo "--- license-scanner (license compliance) ---"
      license-scanner --dir . 2>/dev/null | head -30 || FAILED=1
    '';
  };
}
