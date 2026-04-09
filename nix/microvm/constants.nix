# nix/microvm/constants.nix
#
# MicroVM-specific constants: variant definitions, port allocation, and timeouts.
# Extends the shared nix/constants.nix with VM-specific concerns.
#
let
  constants = import ../constants.nix;
in
{
  inherit (constants.microvm)
    ram
    vcpus
    consolePortBase
    sshPassword
    ;

  # Console port allocation — each variant gets a 10-port block.
  # serial (ttyS0) = base + (offset * 10), virtio (hvc0) = serial + 1
  getConsolePorts =
    variant:
    let
      offsets = {
        gateway = 0;
        gateway-ollama = 1;
      };
      offset = offsets.${variant} or 0;
      serial = constants.microvm.consolePortBase + (offset * 10);
    in
    {
      inherit serial;
      virtio = serial + 1;
    };

  # Dynamic hostname based on variant
  getHostname = variant: if variant == "gateway" then "openclaw-vm" else "openclaw-${variant}-vm";

  # Variant definitions
  variants = {
    gateway = {
      description = "OpenClaw gateway";
      enableOllama = false;
      portOffset = constants.microvm.portOffsets.gateway;
    };
    gateway-ollama = {
      description = "OpenClaw gateway + Ollama inference";
      enableOllama = true;
      portOffset = constants.microvm.portOffsets.gateway-ollama;
    };
  };
}
