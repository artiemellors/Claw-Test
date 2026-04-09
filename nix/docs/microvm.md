# MicroVMs

Nix builds hardened NixOS MicroVMs that run the OpenClaw gateway in an isolated
virtual machine with comprehensive systemd security controls.

> **Linux only.** MicroVMs require a Linux host with KVM support.

---

## Quick Start

```bash
# Start the gateway MicroVM
nix run .#openclaw-microvm

# Connect to the virtio console (high-speed, no SSH needed)
socat -,rawer tcp:localhost:15501
```

## Available Variants

| Target                              | Services               | Console Port |
|-------------------------------------|------------------------|--------------|
| `nix run .#openclaw-microvm`        | OpenClaw gateway       | 15501        |
| `nix run .#openclaw-microvm-ollama` | Gateway + Ollama       | 15511        |

### Gateway Only

Runs the OpenClaw gateway as a hardened systemd service:

```bash
nix run .#openclaw-microvm
```

The gateway listens on port 18789 inside the VM, forwarded to the host.

### Gateway + Ollama

Self-contained inference: the VM runs both the OpenClaw gateway and Ollama:

```bash
nix run .#openclaw-microvm-ollama
```

## Connecting to the VM

### Virtio Console (recommended)

High-speed virtio serial console — no SSH overhead, available as soon as the
kernel loads virtio drivers:

```bash
socat -,rawer tcp:localhost:15501    # Gateway VM
socat -,rawer tcp:localhost:15511    # Gateway + Ollama VM
```

### Serial Console

Traditional serial console, available from the very start of boot (useful for
debugging early boot issues):

```bash
nc localhost 15500                   # Gateway VM
nc localhost 15510                   # Gateway + Ollama VM
```

### SSH (debug mode)

In debug mode (the default), password authentication is enabled:

- **User:** root
- **Password:** openclaw

SSH port forwarding is set up automatically.

## Security Hardening

The MicroVM uses a comprehensive systemd security baseline
(`nix/modules/hardening.nix`) applied to all services:

### Baseline Controls

| Control                      | Setting         | Purpose                          |
|------------------------------|-----------------|----------------------------------|
| CapabilityBoundingSet        | `""` (none)     | Zero capabilities by default     |
| ProtectSystem                | `strict`        | Read-only /usr, /boot, /etc      |
| ProtectHome                  | `true`          | Hide /home, /root                |
| PrivateTmp                   | `true`          | Private /tmp per service         |
| PrivateIPC                   | `true`          | Isolated IPC namespaces          |
| MemoryDenyWriteExecute       | `true`          | Block W^X pages (see note below) |
| ProtectKernelTunables        | `true`          | Block /proc/sys writes           |
| ProtectKernelModules         | `true`          | Disable module loading           |
| RestrictNamespaces           | `true`          | Block namespace creation         |
| SystemCallFilter             | `@system-service ~@privileged ...` | Allowlist syscalls |
| ExecPaths                    | `["/nix/store"]`| Only Nix store binaries execute  |
| NoExecPaths                  | `["/var" "/tmp" "/run" ...]`       | No code from data dirs |
| IPAddressDeny                | `any`           | Network deny-all by default      |

### OpenClaw Gateway Overrides

The gateway service overrides only what it needs:

| Override                     | Value           | Why                              |
|------------------------------|-----------------|----------------------------------|
| MemoryDenyWriteExecute       | `false`         | **V8 JIT requires W+X pages**    |
| IPAddressAllow               | `any`           | Gateway needs network access     |
| SocketBindAllow              | `tcp:18789`     | Only the gateway port            |
| RestrictAddressFamilies      | `AF_INET AF_INET6 AF_UNIX` | TCP + Unix sockets |

> **Why MemoryDenyWriteExecute = false?** Node.js uses the V8 JavaScript
> engine, which compiles JavaScript to native machine code at runtime (JIT).
> This requires allocating memory pages that are both writable and executable.
> This is the single most important hardening exception — all other controls
> remain strict.

### Security Scoring

The target score for `systemd-analyze security openclaw-gateway` is **<= 2.5**
(out of 10, where lower is more secure). Verify inside the VM:

```bash
systemd-analyze security openclaw-gateway
```

### Resource Limits

The gateway runs in a dedicated systemd slice with resource controls:

| Limit      | Value  |
|------------|--------|
| MemoryHigh | 80%    |
| MemoryMax  | 90%    |
| CPUQuota   | 80%    |
| TasksMax   | 256    |

## How It Works

### Architecture

```
Host
 └── QEMU (via astro/microvm.nix)
      └── NixOS (minimal)
           ├── openclaw-gateway.service  (hardened)
           ├── ollama.service            (optional, gateway-ollama variant)
           └── openssh.service           (debug mode only)
```

The MicroVM uses:

- **QEMU hypervisor** via [microvm.nix](https://github.com/astro/microvm.nix)
- **Shared /nix/store** via 9P (read-only) — no full filesystem copy
- **1024 MB RAM**, 4 vCPUs (configurable in `nix/constants.nix`)
- **User-mode networking** with port forwarding (default) or TAP bridge

### NixOS Module

The OpenClaw gateway is defined as a proper NixOS module
(`nix/modules/openclaw-gateway.nix`) with typed options:

```nix
services.openclaw-gateway = {
  enable = true;
  package = openclaw;
  settings.port = 18789;
  settings.host = "0.0.0.0";
  openFirewall = false;
};
```

This module is reusable — anyone running NixOS can import it directly to run
the OpenClaw gateway as a system service with full hardening, independent of
the MicroVM.

## Configuration

MicroVM constants are in `nix/constants.nix` and `nix/microvm/constants.nix`:

| Constant               | Value   | Purpose                        |
|------------------------|---------|--------------------------------|
| `microvm.ram`          | `1024`  | VM memory (MB)                 |
| `microvm.vcpus`        | `4`     | Virtual CPUs                   |
| `microvm.consolePortBase` | `15500` | TCP port for serial consoles |
| `ports.openclaw-gateway` | `18789` | Gateway listen port          |

### Console Port Allocation

Each variant gets a 10-port block starting from the console port base:

| Variant          | Serial (ttyS0) | Virtio (hvc0) |
|------------------|-----------------|---------------|
| gateway          | 15500           | 15501         |
| gateway-ollama   | 15510           | 15511         |

## Adding a New Variant

1. Add the variant definition to `nix/microvm/constants.nix`:

```nix
variants = {
  # ... existing variants ...
  my-variant = {
    description = "OpenClaw + custom service";
    enableOllama = true;
    portOffset = 200;
  };
};
```

2. The flake automatically generates `packages` and `apps` entries from the
   variant matrix — no manual wiring needed.
