# nix/modules/openclaw-gateway.nix
#
# NixOS module for the OpenClaw gateway service.
#
# Usage:
#   services.openclaw-gateway.enable = true;
#   services.openclaw-gateway.package = openclaw;  # or passed via specialArgs
#
# The gateway listens on port 18789 by default.
# HOME is set to /var/lib/openclaw so config and sessions persist there.
#
{
  config,
  lib,
  pkgs,
  openclaw ? null,
  ...
}:
let
  cfg = config.services.openclaw-gateway;
  hardening = import ./hardening.nix;
  modLib = import ./lib.nix { inherit lib; };
in
{
  options.services.openclaw-gateway = {
    enable = lib.mkEnableOption "OpenClaw gateway";

    package = modLib.mkPackageOption {
      serviceName = "openclaw-gateway";
      argName = "openclaw";
      packageArg = openclaw;
    };

    settings = {
      port = lib.mkOption {
        type = lib.types.port;
        default = 18789;
        description = "Gateway listen port.";
      };

      host = lib.mkOption {
        type = lib.types.str;
        default = "127.0.0.1";
        description = "Gateway bind address. Defaults to loopback; set to 0.0.0.0 to listen on all interfaces.";
      };
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open the gateway port in the firewall.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];

    users.users.openclaw = {
      isSystemUser = true;
      group = "openclaw";
      description = "OpenClaw service user";
    };
    users.groups.openclaw = { };

    systemd.services.openclaw-gateway = {
      description = "OpenClaw Gateway";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      environment = {
        HOME = "/var/lib/openclaw";
        NODE_ENV = "production";
      };

      serviceConfig = hardening // {
        Type = "simple";
        User = "openclaw";
        Group = "openclaw";
        StateDirectory = "openclaw";
        RuntimeDirectory = "openclaw";
        TimeoutStopSec = 10;

        ExecStart = lib.concatStringsSep " " [
          "${cfg.package}/bin/openclaw"
          "gateway"
          "run"
          "--bind"
          cfg.settings.host
          "--port"
          (toString cfg.settings.port)
        ];

        # --- Hardening overrides for Node.js / OpenClaw ---

        # CRITICAL: V8 JIT requires write+execute memory pages.
        # This is the single most important hardening exception.
        MemoryDenyWriteExecute = false;

        # Gateway needs TCP networking
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
          "AF_UNIX"
        ];
        IPAddressAllow = "any";
        IPAddressDeny = "";

        # Restrict socket binding to only the gateway port
        SocketBindAllow = [ "tcp:${toString cfg.settings.port}" ];
        SocketBindDeny = "any";

        ReadWritePaths = [ "/var/lib/openclaw" ];

        Slice = "openclaw.slice";
      };
    };

    systemd.slices.openclaw = {
      description = "OpenClaw Resource Slice";
      sliceConfig = {
        MemoryHigh = "80%";
        MemoryMax = "90%";
        CPUQuota = "80%";
        TasksMax = 256;
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [
      cfg.settings.port
    ];
  };
}
