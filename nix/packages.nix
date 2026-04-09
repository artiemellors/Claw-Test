# nix/packages.nix
#
# Development tool declarations for the OpenClaw dev shell.
# Single source of truth for all toolchain dependencies.
#
{
  pkgs,
  lib,
  nodejs,
  pnpm,
}:

let
  # Core build toolchain
  buildTools = [
    nodejs
    pnpm
    pkgs.git
    pkgs.python3
    pkgs.pkg-config
    pkgs.gnumake
  ];

  # Code quality tools (provided by Nix so versions are pinned)
  qualityTools = [
    pkgs.ripgrep
    pkgs.nixfmt-tree
    pkgs.nil # Nix LSP
  ];

  # ASCII art for the welcome banner
  bannerTools = [
    pkgs.jp2a
  ];

  # Native module build dependencies
  nativeDeps =
    with pkgs;
    [
      openssl
    ]
    ++ lib.optionals stdenv.isLinux [
      stdenv.cc.cc.lib
    ];

in
{
  inherit
    buildTools
    qualityTools
    bannerTools
    nativeDeps
    ;

  # All packages combined (for mkShell.packages).
  allPackages = buildTools ++ qualityTools ++ bannerTools;
}
