# OCI Containers

Nix builds minimal, reproducible OCI container images for OpenClaw. The images
use `streamLayeredImage` — no multi-GB intermediate tarballs, no Dockerfile, and
every byte is hash-verified.

> **Linux only.** Container builds require a Linux host (or WSL2).

---

## Quick Start

```bash
# Build and load into Docker
nix build .#openclaw-container && ./result | docker load

# Run the gateway
docker run -p 18789:18789 openclaw:latest
```

For Podman, replace `docker` with `podman`.

## Available Images

| Target                                | Contents               | Port  | Compressed |
|---------------------------------------|------------------------|-------|------------|
| `nix build .#openclaw-container`      | OpenClaw gateway       | 18789 | ~412 MB    |
| `nix build .#openclaw-container-slim` | Gateway (stripped)     | 18789 | ~394 MB    |
| `nix build .#openclaw-container-with-ollama` | Gateway + Ollama | 18789 | ~451 MB    |

> **About the size:** These images are the same total size as a traditional
> `node:22-slim` + `npm install` Docker build (~1.1 GB), but every byte is
> hash-verified and there is no shell, package manager, or coreutils inside
> the container. See [Image Size Explained](#image-size-explained) for details.

The `-slim` variant strips nodejs `-dev` headers and build tools from the
closure. Run `nix run .#container-size` to measure current sizes and inspect
the closure.

### Standalone Gateway

The simplest image. Runs the OpenClaw gateway on port 18789:

```bash
nix build .#openclaw-container && ./result | docker load
docker run -p 18789:18789 openclaw:latest
```

### Gateway + Ollama

Self-contained: starts Ollama in the background, health-checks it, then
launches the OpenClaw gateway. No external inference server needed:

```bash
nix build .#openclaw-container-with-ollama && ./result | docker load
docker run -p 18789:18789 openclaw-with-ollama:latest
```

## How It Works

### Build Approach

The images are built with `pkgs.dockerTools.streamLayeredImage`:

- **No Dockerfile.** The image is defined declaratively in Nix.
- **Streaming output.** The derivation produces an executable script that
  streams a Docker-compatible tarball to stdout. Pipe it directly to
  `docker load` or `podman load`.
- **Layer caching.** Dependencies (cacert, tzdata, Node.js) go in lower layers
  that change rarely. The OpenClaw package goes in the top layer.
- **Input hash label.** Each image has a `nix.inputs.hash` label — a SHA-256
  fingerprint of all inputs. CI can compare this label to skip rebuilds when
  nothing changed.

### Non-Root Execution

All containers run as the `openclaw` user (UID 990), not root. The user
identity is embedded via `/etc/passwd` and `/etc/group` files included in the
image contents.

### Minimal Contents

Each image contains only what is needed:

- The OpenClaw package (Node.js app)
- `cacert` — TLS CA certificates
- `tzdata` — timezone data for log timestamps
- `/etc/passwd` and `/etc/group` for non-root execution

No shell, no coreutils, no package manager. This minimizes attack surface.

### Image Size Explained

**If you are coming from Docker, the image sizes may look large. They are
not.** A traditional Docker build of the same app is the same total size
or larger. The difference is that Nix is transparent about what is inside.

A traditional Dockerfile starts with `FROM node:22-slim` (76 MB), then runs
`npm install` (which adds ~800 MB of node_modules) and copies the app dist/
(~216 MB). The total on disk is ~1.1 GB. Docker Hub shows only the base
image size; the full image after build is comparable to the Nix container.

The Nix image is ~100 MB larger because Nix does not share system libraries.
Every `/nix/store/` path carries its own copies of libssl, libicu, zlib,
etc. This is the reproducibility tradeoff. In return, you get:

| Property | Nix container | Traditional Docker |
|----------|--------------|-------------------|
| Every byte hash-verified | Yes | No (apt-get can drift) |
| Shell / package manager inside | None | /bin/sh, apt, etc. |
| Downloads at startup | None | Possible (npm install) |
| Reproducible on any machine | Yes | Depends on registry state |
| Supply chain audit | `nix path-info -rsSh` | Opaque layers |

**Build optimizations applied:**

The Nix flake builds from the local repo source and strips non-production
dependencies:

1. `pnpm prune --prod` removes devDependencies
2. `@node-llama-cpp` (664 MB), `@lancedb` (128 MB), and `typescript`
   (24 MB) are removed (not needed for gateway)
3. Python3 references are stripped from koffi codegen scripts (~180 MB
   closure savings)
4. The `-slim` variant strips nodejs `-dev` header references (~18 MB)

Run `nix run .#container-size` to measure current sizes and see the top
closure entries.

## Architecture

The container factory lives in `nix/containers/default.nix`. It provides a
`mkContainer` helper that standardizes:

- Base contents (cacert, tzdata, user files)
- Environment variables (SSL_CERT_FILE, TZDIR, NODE_ENV, HOME)
- OCI labels (input hash, image title, source URL)
- Non-root user configuration

Adding a new container variant means adding one `mkContainer` call.

## Configuration

Container constants are in `nix/constants.nix`:

| Constant                | Value      | Purpose                   |
|-------------------------|------------|---------------------------|
| `container.user`        | `openclaw` | Container runtime user    |
| `container.uid`         | `990`      | User ID                   |
| `container.gid`         | `990`      | Group ID                  |
| `ports.openclaw-gateway`| `18789`    | Gateway listen port       |
