# nix/modules/default.nix
#
# Re-export all OpenClaw NixOS service modules.
# Import this to get the full set of module options.
#
{ ... }:
{
  imports = [
    ./openclaw-gateway.nix
  ];
}
