# Why Nix?

This document explains what Nix is, why OpenClaw uses it, and how it compares
to traditional install scripts.

---

## What is Nix?

[Nix](https://nixos.org) is a package manager for Linux, macOS, and Windows
(via WSL2) that provides **reproducible, isolated** environments.

Unlike `apt`, `brew`, or `npm -g`, Nix does not install packages into global
system directories. Instead, every package lives in the **Nix store**
(`/nix/store/`), identified by a cryptographic hash of its contents and all its
dependencies:

```
/nix/store/4xw8n979xpivdc46a9ndcvyhwgif00hz-nodejs-22.14.0/
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
           SHA-256 hash — if any input changes, this changes
```

This means:

- **No conflicts** — different projects can use different versions of the same
  tool without interfering
- **No "it works on my machine"** — the same hash guarantees the same bytes on
  every machine
- **No cleanup needed** — exit the dev shell and everything effectively
  disappears; run `nix store gc` to reclaim disk space

## What is a Flake?

A **flake** is a Nix project with two files:

- **`flake.nix`** — declares what the project provides (dev shells, packages,
  apps, checks) and what it depends on (nixpkgs, other flakes)
- **`flake.lock`** — pins exact versions of every dependency so all users get
  identical results

When you run `nix develop`, Nix reads `flake.nix`, resolves dependencies from
the pinned `flake.lock`, downloads or builds everything into `/nix/store/`, and
drops you into a shell with the right tools on `$PATH`.

## Why Nix for OpenClaw?

### 1. Reproducible Development Environment

OpenClaw requires Node 22+, pnpm, and several native build tools. Without Nix,
setting these up varies by OS, distro, and existing system state. With Nix:

```bash
nix develop
```

One command. Every contributor — on Ubuntu, Fedora, Arch, macOS, or Windows
WSL2 — gets the identical toolchain.

### 2. One-Command Local Inference

Nix can start a GPU-accelerated inference engine and OpenClaw together:

```bash
nix run .#with-ollama-cuda
```

Ollama starts with NVIDIA CUDA, OpenClaw connects to it, everything is
hash-verified and version-pinned. Exit and everything stops cleanly.

### 3. Wide Platform Support

| Platform            | Status | Notes                                   |
|---------------------|--------|-----------------------------------------|
| Linux x86_64        | Native | First-class                             |
| Linux aarch64       | Native | Raspberry Pi, ARM servers               |
| macOS Apple Silicon | Native | M1/M2/M3/M4                            |
| macOS Intel         | Native | Full support                            |
| Windows (WSL2)      | Native | Real Linux kernel, no emulation         |

WSL2 runs a real Linux kernel, so Nix runs natively inside it — no
compatibility shims. This means a contributor on an M3 MacBook, a developer on
Fedora, and someone on Windows 11 with WSL2 all get the exact same toolchain.

## Security: Nix vs Install Scripts

Many projects offer "curl | bash" one-liner installers. These are convenient
but have fundamental security limitations.

### The Problem with curl | bash

```bash
# This pattern is common but risky:
curl -fsSL https://example.com/install.sh | bash
```

- **No review** — code executes before you can read it
- **No integrity check** — you trust that the server has not been compromised
  and that no one tampered with the download in transit
- **No reproducibility** — running the same script a week later may pull
  different versions of everything
- **No isolation** — scripts install packages system-wide, potentially
  conflicting with existing tools
- **Nested downloads** — install scripts often chain additional `curl | bash`
  calls (Homebrew, GPG keys, other installers), compounding the risk
- **No rollback** — if something breaks, you are left cleaning up manually

### How Nix Solves This

| Concern              | curl \| bash                           | Nix Flake                                    |
|----------------------|----------------------------------------|----------------------------------------------|
| **Delivery**         | Code runs before review                | Clone repo, inspect `flake.nix` first         |
| **Integrity**        | Relies solely on TLS                   | NAR hash (SHA-256) per dependency in `flake.lock` — any tampering = build failure |
| **Reproducibility**  | Downloads "latest" at runtime          | `flake.lock` pins exact nixpkgs commit         |
| **Isolation**        | Installs system-wide                   | Packages live in `/nix/store/`, never conflict |
| **Nested downloads** | Chains multiple unverified fetches     | All packages from Nix store with verified hashes |
| **Privilege**        | Often needs `sudo`                     | Nix store is user-writable after initial install |
| **Rollback**         | Manual cleanup                         | Exit shell, run `nix store gc`                |

### Cryptographic Verification

Every package in the Nix store is **content-addressed** — its path includes a
hash of its entire dependency closure. If any input changes (source code,
compiler version, build flags), the hash changes and Nix rebuilds from scratch.

This is fundamentally different from checking a download's SHA-256 after the
fact. Nix's hashing is **structural**: it guarantees not just that you got the
right tarball, but that the tarball was built from the right sources, with the
right compiler, linked against the right libraries.

```
flake.lock excerpt:

"nixpkgs": {
  "locked": {
    "narHash": "sha256-abc123...",   <-- every dependency verified
    "rev": "a1b2c3d4...",            <-- exact commit pinned
    ...
  }
}
```

## Further Reading

- [Nix official site](https://nixos.org)
- [Nix Flakes wiki](https://nixos.wiki/wiki/flakes)
- [Zero to Nix](https://zero-to-nix.com) — interactive beginner tutorial
- [nix.dev](https://nix.dev) — official learning resources
