# Quick Start

Get from zero to a working OpenClaw development environment in 5 minutes.

---

## 1. Install Nix

If you already have Nix installed, skip to [step 2](#2-enable-flakes).

### Linux / macOS / WSL2

**Multi-user install** (recommended):

```bash
bash <(curl -L https://nixos.org/nix/install) --daemon
```

**Single-user install** (no root after install):

```bash
bash <(curl -L https://nixos.org/nix/install) --no-daemon
```

> **Windows users:** Install [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install)
> first (`wsl --install` in PowerShell), then run the Linux install command
> inside your WSL2 distro.

### Verify Installation

```bash
nix --version
# nix (Nix) 2.x.x
```

## 2. Enable Flakes

Flakes are a modern Nix feature that OpenClaw uses. If not already enabled:

```bash
# Create config directory if needed
test -d /etc/nix || sudo mkdir /etc/nix

# Enable flakes permanently
echo 'experimental-features = nix-command flakes' | sudo tee -a /etc/nix/nix.conf

# Restart the Nix daemon (if using multi-user install)
sudo systemctl restart nix-daemon
```

Alternatively, you can prefix any command without permanent config:

```bash
nix --extra-experimental-features 'nix-command flakes' develop
```

## 3. Enter the Development Shell

```bash
cd openclaw
nix develop
```

This will:
- Download and cache all required tools (Node 22, pnpm, linters, etc.)
- Drop you into a shell with everything on `$PATH`
- Display the OpenClaw ASCII art banner

> **First run:** Nix downloads and builds all dependencies, which takes a few
> minutes depending on your connection. Subsequent runs are near-instant
> because everything is cached in `/nix/store/`.

## 4. Install Dependencies and Build

Inside the dev shell:

```bash
pnpm install
pnpm build
```

You now have a fully working OpenClaw development environment.

## 5. Run the Dev Loop

```bash
pnpm check       # Format + lint + typecheck
pnpm test         # Run tests
pnpm dev          # Run CLI in dev mode
```

## 6. (Optional) Try Local Inference

If you want to run OpenClaw with a local LLM, try one of the inference runners:

```bash
# Exit the dev shell first (these are standalone runners)
exit

# Run with Ollama (auto-detects GPU)
nix run .#with-ollama
```

See [Inference Runners](inference.md) for the full list of GPU-accelerated
targets.

## 7. (Optional) Build a Container or MicroVM

On Linux, you can also package OpenClaw as a minimal OCI container or run it
in a hardened NixOS MicroVM:

```bash
# OCI container — stream into Docker
nix build .#openclaw-container && ./result | docker load
docker run -p 18789:18789 openclaw:latest

# MicroVM — hardened NixOS VM with systemd security controls
nix run .#openclaw-microvm
socat -,rawer tcp:localhost:15501   # Connect via virtio console
```

See [OCI Containers](containers.md) and [MicroVMs](microvm.md) for details.

---

## What Just Happened?

When you ran `nix develop`, Nix:

1. Read `flake.nix` and `flake.lock` to determine exact dependency versions
2. Downloaded pre-built packages from the Nix binary cache (or built from
   source if not cached)
3. Stored everything in `/nix/store/` — isolated from your system packages
4. Created a temporary shell environment with the right tools on `$PATH`

When you exit the shell (`exit` or Ctrl-D), the tools are no longer on your
`$PATH`, but they remain cached in `/nix/store/` for next time. To reclaim
disk space: `nix store gc`.
