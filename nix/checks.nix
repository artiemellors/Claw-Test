# nix/checks.nix
#
# Nix check derivations that wrap OpenClaw's existing verification gates.
# Run via: nix flake check
#
# These map directly to the project's pnpm scripts:
#   check-format  ->  pnpm format
#   check-lint    ->  pnpm check  (format + lint + typecheck)
#   check-test    ->  pnpm test
#
{
  pkgs,
  lib,
  src,
  nodejs,
  pnpm,
  pnpmDeps,
}:

let
  basePnpmAttrs = {
    inherit src;
    strictDeps = true;
    nativeBuildInputs = [
      nodejs
      pnpm
      pkgs.pnpmConfigHook
    ];
    inherit pnpmDeps;
  };

  mkCheck =
    name: script: extraAttrs:
    pkgs.stdenvNoCC.mkDerivation (
      basePnpmAttrs
      // {
        name = "openclaw-${name}";
        buildPhase = ''
          runHook preBuild
          export HOME=$TMPDIR
          echo "manage-package-manager-versions=false" >> .npmrc
          pnpm run ${script}
          runHook postBuild
        '';
        installPhase = ''
          mkdir -p $out
          echo "${name} passed" > $out/result
        '';
      }
      // extraAttrs
    );

in
{
  check-lint = mkCheck "lint" "check" { };
  check-test = mkCheck "test" "test" { CI = "true"; };
  check-format = pkgs.stdenvNoCC.mkDerivation {
    name = "openclaw-nix-format";
    src = ../.;
    strictDeps = true;
    nativeBuildInputs = [ pkgs.nixfmt ];
    buildPhase = ''
      runHook preBuild
      nixfmt --check flake.nix nix/
      runHook postBuild
    '';
    installPhase = ''
      mkdir -p $out
      echo "nix format check passed" > $out/result
    '';
  };
}
