# Inference Runners

OpenClaw connects to external LLM providers via HTTP — it does not run model
inference itself. The Nix flake provides **one-command runners** that start a
GPU-accelerated inference engine and OpenClaw together.

---

## One-Command Quick Start

```bash
# No setup, no manual installs — one command to a running AI assistant:
nix run .#with-ollama
```

Nix downloads Ollama and OpenClaw (hash-verified, version-pinned), starts
Ollama, waits for it to be ready, and launches OpenClaw connected to it.
Exit and everything stops cleanly.

## Available Targets

### Ollama

| Target                     | GPU Backend                  |
|----------------------------|------------------------------|
| `nix run .#with-ollama`         | Auto-detect / CPU fallback   |
| `nix run .#with-ollama-cuda`    | NVIDIA GPU (CUDA)            |
| `nix run .#with-ollama-rocm`    | AMD GPU (ROCm)               |
| `nix run .#with-ollama-vulkan`  | Intel Arc / generic (Vulkan) |

Ollama is the easiest option — it manages model downloads and serves an
OpenAI-compatible API. On first run, you will be prompted to pull a model.

### llama.cpp

| Target                          | GPU Backend                       |
|---------------------------------|-----------------------------------|
| `nix run .#with-llama-cpp`           | Auto-detect / CPU / macOS Metal   |
| `nix run .#with-llama-cpp-vulkan`    | Intel Arc / generic (Vulkan)      |

llama.cpp requires you to provide a GGUF model file. Pass it before `--`:

```bash
nix run .#with-llama-cpp -- --model ./models/llama-3-8b.Q4_K_M.gguf
```

Pass OpenClaw arguments after a second `--`:

```bash
nix run .#with-llama-cpp -- --model ./models/llama-3-8b.Q4_K_M.gguf -- gateway run
```

### vLLM

| Target                | GPU Backend              |
|-----------------------|--------------------------|
| `nix run .#with-vllm`     | GPU via PyTorch (CUDA/ROCm) |

vLLM is a high-throughput inference server. It downloads models from Hugging
Face:

```bash
nix run .#with-vllm -- --model meta-llama/Llama-3-8B
```

> **Note:** vLLM requires a CUDA or ROCm GPU. CPU-only and Vulkan are not
> supported.

### Standalone OpenClaw

```bash
nix run .#openclaw           # Just the OpenClaw CLI (bring your own inference)
```

## GPU Support Matrix

| Target              | NVIDIA (CUDA) | AMD (ROCm) | Intel Arc (Vulkan) | CPU    | macOS Metal |
|---------------------|---------------|------------|--------------------|--------|-------------|
| `with-ollama`       | auto          | auto       | auto               | fallback | -         |
| `with-ollama-cuda`  | explicit      | -          | -                  | -      | -           |
| `with-ollama-rocm`  | -             | explicit   | -                  | -      | -           |
| `with-ollama-vulkan`| -             | -          | explicit           | -      | -           |
| `with-llama-cpp`    | auto          | auto       | auto               | fallback | auto      |
| `with-llama-cpp-vulkan` | -         | -          | explicit           | -      | -           |
| `with-vllm`         | via torch     | via torch  | -                  | fallback | -         |

### Choosing a Backend

- **NVIDIA GPU** — use `-cuda` variants for best performance
- **AMD GPU** — use `-rocm` variants for best performance
- **Intel Arc GPU** — use `-vulkan` variants (generic GPU acceleration via
  Vulkan drivers)
- **CPU only** — use the base variants (no suffix); they auto-detect GPU and
  fall back to CPU
- **macOS Apple Silicon** — `with-llama-cpp` auto-enables Metal acceleration

### Intel Arc GPUs

Intel Arc GPUs are supported via the **Vulkan** backend. Use the `-vulkan`
runner variants:

```bash
nix run .#with-ollama-vulkan
nix run .#with-llama-cpp-vulkan
```

Vulkan provides generic GPU acceleration that works across Intel Arc, NVIDIA,
and AMD GPUs. For NVIDIA and AMD, the dedicated CUDA and ROCm backends offer
better optimized performance, but Vulkan is the universal fallback.

> **Future:** llama.cpp upstream supports Intel's SYCL/oneAPI backend for
> optimized Arc performance. The oneAPI toolkit and Level Zero runtime are
> already packaged in nixpkgs. When nixpkgs exposes the SYCL build flag on
> llama-cpp, we will add dedicated `-sycl` runner variants.

## How It Works

Each runner is a shell script (`nix/runners/with-*.nix`) that:

1. **Starts the inference server** in the background
2. **Polls the health endpoint** until ready (with a timeout)
3. **Launches OpenClaw** configured to connect to the local server
4. **Traps EXIT** for graceful shutdown — when you quit OpenClaw, the
   inference server is stopped automatically

The health-check and cleanup logic is shared via `nix/inference/common.nix`.

Engine-specific configuration (package selection, ports, health endpoints) is
in `nix/inference/{ollama,llama-cpp,vllm}.nix`.

### Ports

| Engine    | Default Port | Health Endpoint |
|-----------|-------------|-----------------|
| Ollama    | 11434       | `/api/tags`     |
| llama.cpp | 8080        | `/health`       |
| vLLM      | 8000        | `/health`       |

Ports and endpoints are defined in `nix/constants.nix`.

## Why This Is Better Than Install Scripts

Traditional setup for local AI:

1. Install Node.js (correct version)
2. Install pnpm
3. Install Ollama (correct version)
4. Configure GPU drivers
5. Download a model
6. Configure endpoints
7. Start Ollama
8. Start OpenClaw
9. Hope the versions are compatible

With Nix:

```bash
nix run .#with-ollama-cuda
```

That's it. One command. Everything is hash-verified, version-pinned, and
reproducible. Works identically on any Linux machine with an NVIDIA GPU.
No `curl | bash`, no unsigned downloads, no version drift.

## Deployment Options

For production deployment, see also:

- **[OCI Containers](containers.md)** — Minimal container images
  (`nix build .#openclaw-container-with-ollama`). Includes an all-in-one
  variant that bundles Ollama for self-contained inference.
- **[MicroVMs](microvm.md)** — Hardened NixOS VMs with systemd security
  scoring (`nix run .#openclaw-microvm-ollama`). Full OS-level isolation
  with zero-capability baseline and V8-specific hardening overrides.
