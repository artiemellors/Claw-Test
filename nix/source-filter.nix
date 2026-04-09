# nix/source-filter.nix
#
# Filters the source tree for Nix store copies, excluding build artifacts,
# editor state, and other non-essential paths.
#
{
  lib,
  constants,
}:

lib.cleanSourceWith {
  src = lib.cleanSource ./..;
  filter =
    path: _type:
    let
      baseName = builtins.baseNameOf path;
    in
    !(builtins.elem baseName constants.ignoredPaths);
}
