# nix/modules/hardening.nix
#
# Shared systemd security baseline for OpenClaw services.
# Merge into each service's serviceConfig via: hardening // { per-service-overrides }
#
# This applies defense-in-depth: zero capabilities, strict filesystem isolation,
# syscall filtering, and network deny-all by default. Services override only
# what they need.
#
# See: systemd-analyze security <service> (target score <= 2.5)
#
{
  NoNewPrivileges = true;
  ProtectSystem = "strict";
  ProtectHome = true;
  ProtectKernelTunables = true;
  ProtectKernelModules = true;
  ProtectControlGroups = true;
  ProtectKernelLogs = true;
  PrivateDevices = true;
  PrivateTmp = true;
  PrivateIPC = true;
  RestrictRealtime = true;
  RestrictSUIDSGID = true;
  RestrictNamespaces = true;
  LockPersonality = true;
  ProtectHostname = true;
  ProtectClock = true;
  MemoryDenyWriteExecute = true;
  UMask = "0077";

  # Drop all capabilities — empty string means "no capabilities at all".
  # NB: an empty *list* [] produces no directive and systemd defaults to all caps.
  CapabilityBoundingSet = "";
  AmbientCapabilities = "";

  SystemCallArchitectures = [ "native" ];
  SystemCallFilter = [
    "@system-service"
    "~@privileged"
    "~@mount"
    "~@debug"
    "~@module"
    "~@reboot"
    "~@swap"
    "~@clock"
    "~@cpu-emulation"
    "~@obsolete"
    "~@raw-io"
    "~@resources"
  ];

  RemoveIPC = true;
  ProtectProc = "invisible";
  ProcSubset = "pid";
  KeyringMode = "private";
  NotifyAccess = "none";

  # Explicit device policy (PrivateDevices=true implies, but scoring checks separately)
  DevicePolicy = "closed";
  DeviceAllow = "";

  # Default-deny IP addresses at systemd level.
  # Each service overrides with IPAddressAllow for its needs.
  IPAddressDeny = "any";

  # Prevent code execution from data directories.
  # All executables live in /nix/store (Nix hermetic builds).
  NoExecPaths = [
    "/var"
    "/tmp"
    "/run"
    "/home"
    "/root"
  ];
  ExecPaths = [ "/nix/store" ];

  Restart = "always";
  RestartSec = "1s";
}
