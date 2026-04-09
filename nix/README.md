# OpenClaw — Nix Development Environment

Nix provides a reproducible, hash-verified development environment,
one-command local inference runners, minimal OCI containers, and
hardened MicroVMs for OpenClaw.

## Platform Support

| Platform            | Status | Notes                                     |
|---------------------|--------|-------------------------------------------|
| Linux x86_64        | Native | First-class, all features                 |
| Linux aarch64       | Native | Raspberry Pi, ARM servers, Ampere cloud   |
| macOS Apple Silicon | Native | Dev shell + inference runners             |
| macOS Intel         | Native | Dev shell + inference runners             |
| Windows (WSL2)      | Native | Install Nix inside any WSL2 distro        |

> **Note:** OCI containers and MicroVMs are Linux-only features.
> Dev shells and inference runners work on all platforms.

## Get Started

1. **New to Nix?** Read [Why Nix?](docs/why-nix.md)
2. **Ready to go?** Follow the [Quick Start](docs/quickstart.md)
3. **Want local AI?** See [Inference Runners](docs/inference.md)
4. **Want containers?** See [OCI Containers](docs/containers.md)
5. **Want MicroVMs?** See [MicroVMs](docs/microvm.md)
6. **Want static analysis?** See [Analysis Tools](docs/analysis.md)

## Documentation

| Doc                                        | Description                              |
|--------------------------------------------|------------------------------------------|
| [Why Nix?](docs/why-nix.md)               | What Nix is, security model, vs scripts  |
| [Quick Start](docs/quickstart.md)          | Install to dev shell in 5 minutes        |
| [Dev Shell](docs/dev-shell.md)             | Tools, env vars, welcome banner          |
| [Inference Runners](docs/inference.md)     | One-command local AI with GPU support    |
| [OCI Containers](docs/containers.md)       | Minimal container images for deployment  |
| [MicroVMs](docs/microvm.md)               | Hardened NixOS VMs with security scoring |
| [Analysis Tools](docs/analysis.md)         | 45 static analysis tools in 7 categories |
| [Checks](docs/checks.md)                  | Linting, testing, CI via nix flake check |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes                  |

## Nix Module Map

```
flake.nix                          Entry point — wires up all modules
nix/
├── constants.nix                  Version strings, ports, project metadata
├── openclaw.nix                   Local openclaw build (pnpm prune --prod)
├── packages.nix                   Dev tool declarations (Node 22, pnpm, etc.)
├── shell.nix                      Dev shell configuration
├── shell-functions/
│   └── ascii-art.nix              Welcome banner logo
├── checks.nix                     nix flake check derivations
├── source-filter.nix              Source filtering for builds
├── inference/                     Inference engine modules
│   ├── common.nix                 Shared lifecycle (health-check, cleanup, arg splitting)
│   ├── ollama.nix                 Ollama (CUDA / ROCm / Vulkan / CPU)
│   ├── llama-cpp.nix              llama.cpp server (ROCm / Vulkan / CPU / Metal)
│   └── vllm.nix                   vLLM (CUDA / ROCm via PyTorch)
├── runners/                       Combined OpenClaw + inference runners
│   ├── with-ollama.nix            Ollama + OpenClaw
│   ├── with-llama-cpp.nix         llama.cpp + OpenClaw
│   └── with-vllm.nix              vLLM + OpenClaw
├── containers/                    OCI container images (Linux only)
│   ├── default.nix                streamLayeredImage factory + variants
│   └── openclaw-slim.nix          Closure-optimized openclaw (strips -dev)
├── modules/                       NixOS service modules
│   ├── hardening.nix              Systemd security baseline (zero-capability)
│   ├── openclaw-gateway.nix       Gateway service with hardening overrides
│   ├── lib.nix                    Shared module helpers
│   └── default.nix                Re-export all modules
├── microvm/                       MicroVM definitions (Linux only)
│   ├── microvm.nix                Parametric MicroVM generator (QEMU)
│   └── constants.nix              VM variants, console ports, resource defaults
├── analysis/                      Static analysis suite (45 tools)
│   ├── default.nix                Combines all categories
│   ├── nix.nix                    statix, deadnix, nixfmt
│   ├── typescript.nix             oxlint, biome, eslint
│   ├── security.nix               trivy, grype, gitleaks, trufflehog
│   ├── code-quality.nix           shellcheck, shfmt, actionlint, typos, codespell
│   ├── container.nix              hadolint, dockle
│   ├── docs.nix                   markdownlint-cli2, markdown-link-check
│   └── supply-chain.nix           syft, cosign, licensee, license-scanner
└── docs/                          Documentation
    ├── why-nix.md
    ├── quickstart.md
    ├── dev-shell.md
    ├── inference.md
    ├── containers.md
    ├── microvm.md
    ├── analysis.md
    ├── checks.md
    └── troubleshooting.md
```

## Container Image Sizes

> **These images look large at first glance. They are not.** Read on to
> understand why the Nix images are the same total size (or smaller) than a
> traditional Docker build, while being significantly more secure.

| Image                              | Compressed | Uncompressed |
|------------------------------------|------------|--------------|
| `openclaw-container`               | ~412 MB    | ~1.6 GB      |
| `openclaw-container-slim`          | ~394 MB    | ~1.6 GB      |
| `openclaw-container-with-ollama`   | ~451 MB    | ~1.7 GB      |

Run `nix run .#container-size` to measure current sizes and inspect the
full closure.

### Why the size is honest (and other images are not)

A traditional Dockerfile for a Node.js app starts with something like
`FROM node:22-slim` (~76 MB). That looks small, but it is misleading:

```
Traditional Dockerfile           Nix container
========================         ========================
node:22-slim base   ~76 MB      (no base image)
+ npm install      ~800 MB      node_modules   ~800 MB
+ app dist/        ~216 MB      dist/          ~216 MB
+ system libs        shared     system libs     ~120 MB
                   ----------                  ----------
Total              ~1.1 GB      Total          ~1.2 GB
```

The Nix image is ~100 MB larger because Nix does not share system
libraries between packages. Every package in `/nix/store/` carries its own
copies of libssl, libicu, zlib, etc. This is the cost of reproducibility,
and it buys you:

- **Every byte is hash-verified.** The exact same image builds on any
  machine, any CI, any time. There is no `apt-get update` that silently
  changes what you ship.
- **No shell, no package manager, no coreutils.** The container has no
  `/bin/sh`, no `apt`, no `curl`. If an attacker gets code execution inside
  the container, there are no tools to escalate with.
- **No hidden download-at-startup.** All dependencies are pre-baked. The
  container starts instantly and does not pull anything from npm or Docker
  Hub at runtime.
- **Full supply chain auditability.** `nix path-info -rsSh` shows every
  store path and its size. Nothing is opaque.

A traditional Docker build hides the same ~800 MB of node_modules inside
a layer that `docker images` reports as a combined size with the base. The
total bytes on disk are comparable. The Nix image is just more transparent
about it.

### How we keep it small

The Nix flake builds from the local repo source (not the nixpkgs openclaw
package, which ships 1.9 GB of node_modules including all build-time
dependencies). Our optimizations:

1. **`pnpm prune --prod`** — strips devDependencies (vitest, oxlint,
   rolldown, etc.) after build
2. **Non-gateway package removal** — `@node-llama-cpp` (664 MB, local
   inference binaries), `@lancedb` (128 MB, vector DB engine), and
   `typescript` (24 MB) are removed since the gateway delegates inference
   to external engines
3. **Python reference stripping** — Nix's `patchShebangs` rewrites `.py`
   shebangs in koffi to reference Nix store python3 (~180 MB); our
   `postFixup` reverts these since the scripts are never executed
4. **`-slim` variant** — strips nodejs `-dev` header references that
   pull 12+ build-time packages into the closure (~18 MB savings)

### What is in the ~412 MB

After stripping, the remaining contents are all production dependencies
that openclaw actually uses at runtime:

| Category | Examples | Size |
|----------|----------|------|
| Channel integrations | @slack, @line, matrix-js-sdk, telegraf | ~60 MB |
| AI/API clients | openai, @mistralai, @anthropic-ai | ~35 MB |
| Image processing | sharp, jimp, @napi-rs/canvas | ~50 MB |
| PDF processing | pdfjs-dist | ~72 MB |
| FFI bindings | koffi | ~84 MB |
| Cloud/auth | @aws-sdk, @google, google-auth-library | ~30 MB |
| Tlon integration | @tloncorp | ~97 MB |
| Node.js + system libs | nodejs, openssl, icu, zlib, etc. | ~120 MB |
| Bundled app (dist/) | rolldown output | ~216 MB |
| Other runtime deps | ~400+ packages | ~370 MB |

### Path to smaller images

Further reductions would require:

1. **Smaller dist/** — tree-shaking / dead-code elimination on the bundled
   output could reduce the 216 MB dist/
2. **Feature-gated builds** — optional channel integrations and heavy deps
   (koffi, pdfjs-dist, @tloncorp) could become truly optional
3. **Upstream dep cleanup** — some production dependencies may have lighter
   alternatives

## Quick Reference

```bash
# Development
nix develop                          # Enter dev shell
nix fmt                              # Format all Nix files
nix flake check                      # Run verification checks

# Run OpenClaw with local inference (one command)
nix run .#with-ollama                # Ollama (auto-detect GPU)
nix run .#with-ollama-cuda           # Ollama + NVIDIA
nix run .#with-ollama-rocm           # Ollama + AMD
nix run .#with-ollama-vulkan         # Ollama + Intel Arc / generic GPU
nix run .#with-llama-cpp             # llama.cpp (auto-detect)
nix run .#with-llama-cpp-vulkan      # llama.cpp + Intel Arc / generic GPU
nix run .#with-vllm                  # vLLM (GPU via PyTorch)

# OCI containers (Linux only)
nix build .#openclaw-container && ./result | docker load
nix build .#openclaw-container-slim && ./result | docker load
nix build .#openclaw-container-with-ollama && ./result | docker load
nix run .#container-size                 # Measure image sizes + closure

# MicroVMs (Linux only)
nix run .#openclaw-microvm           # Gateway VM
nix run .#openclaw-microvm-ollama    # Gateway + Ollama VM
socat -,rawer tcp:localhost:15501    # Virtio console (gateway)
socat -,rawer tcp:localhost:15511    # Virtio console (gateway-ollama)

# Static analysis (45 tools, 7 categories)
nix run .#analyze                    # Run all analysis
nix run .#analyze-nix                # Nix linting (statix, deadnix)
nix run .#analyze-typescript         # TS/JS (oxlint, biome)
nix run .#analyze-security           # Security (trivy, grype, gitleaks)
nix run .#analyze-quality            # Code quality (shellcheck, typos)
nix run .#analyze-container          # Dockerfile (hadolint)
nix run .#analyze-docs               # Markdown (markdownlint, link-check)
nix run .#analyze-supply-chain       # SBOM & license (syft, licensee)
nix develop .#analysis               # Shell with all 45 tools

# Standalone
nix run .#openclaw                   # Just OpenClaw CLI

# Maintenance
nix run .#update-deps                # Update flake inputs
nix store gc                         # Reclaim disk space
```
