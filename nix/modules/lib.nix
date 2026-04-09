# nix/modules/lib.nix
#
# Shared helpers for OpenClaw NixOS service modules.
#
{ lib }:
{
  # Common package option — default pulls from specialArgs, throws if absent.
  mkPackageOption =
    {
      serviceName,
      argName,
      packageArg ? null,
    }:
    lib.mkOption {
      type = lib.types.package;
      default =
        if packageArg != null then
          packageArg
        else
          throw "${serviceName} package not found. Pass via specialArgs or set services.${serviceName}.package.";
      defaultText = lib.literalExpression "${argName} (from specialArgs)";
      description = "The ${argName} package to use.";
    };
}
