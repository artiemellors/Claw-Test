# Troubleshooting

Common issues and solutions when using Nix with OpenClaw.

---

## Flakes Not Enabled

**Symptom:**

```
error: experimental Nix feature 'flakes' is disabled
```

**Fix:** Enable flakes permanently:

```bash
test -d /etc/nix || sudo mkdir /etc/nix
echo 'experimental-features = nix-command flakes' | sudo tee -a /etc/nix/nix.conf
sudo systemctl restart nix-daemon    # if using multi-user install
```

Or prefix any single command:

```bash
nix --extra-experimental-features 'nix-command flakes' develop
```

## First Build Is Slow

**Symptom:** `nix develop` or `nix run` takes several minutes on first run.

**Explanation:** Nix is downloading and caching all dependencies in
`/nix/store/`. This only happens once — subsequent runs are near-instant
because Nix reuses the cached packages.

GPU-accelerated inference packages (CUDA, ROCm) are significantly larger
and take longer to download. The CUDA toolkit alone is several GB.

**Tips:**
- Ensure you have a good internet connection for the initial download
- Subsequent `nix develop` invocations will be fast (< 1 second)
- Use `nix store gc` to reclaim space from old/unused packages

## pnpmDeps Hash Mismatch

**Symptom:**

```
hash mismatch in fixed-output derivation
  specified: sha256-...
  got:       sha256-...
```

**Explanation:** The pnpm dependency hash in `flake.nix` does not match the
current `pnpm-lock.yaml`. This happens after adding/removing/updating npm
packages.

**Fix:**

1. In `flake.nix`, find the `pnpmDeps` hash and set it to empty:
   ```nix
   hash = "";
   ```
2. Run `nix build .#pnpmDeps` — it will fail with the correct hash
3. Copy the `got: sha256-...` hash from the error message
4. Replace the empty hash in `flake.nix` with the correct one
5. Commit `flake.nix`

## Native Node Modules Fail to Build

**Symptom:** `pnpm install` fails compiling native modules (sharp, sqlite3, etc.)

**Explanation:** Native Node modules need C/C++ compilers and system libraries.
The dev shell includes `pkg-config`, `gnumake`, and platform-specific build
tools, but some modules may need additional libraries.

**Fix:** Add the missing library to `nix/packages.nix`:

```nix
# In nix/packages.nix, add to nativeDeps:
nativeDeps = with pkgs; [
  openssl
  vips        # <-- for sharp, if needed
];
```

Then re-enter the dev shell: `exit` and `nix develop`.

## GPU Not Detected

**Symptom:** Inference runner falls back to CPU despite having a GPU.

**Check your GPU backend:**

```bash
# NVIDIA
nvidia-smi

# AMD
rocminfo

# Intel Arc
vulkaninfo | head -20
```

**Fix:** Use the explicit GPU variant instead of auto-detect:

```bash
# Instead of:
nix run .#with-ollama

# Use the explicit backend:
nix run .#with-ollama-cuda      # NVIDIA
nix run .#with-ollama-rocm      # AMD
nix run .#with-ollama-vulkan    # Intel Arc
```

## Inference Server Fails to Start

**Symptom:** "ERROR: Ollama failed to start within 30s"

**Possible causes:**

1. **Port conflict** — another service is using the port. Check with
   `ss -ltnp | grep <port>` (see `nix/constants.nix` for default ports)
2. **GPU driver mismatch** — the Nix-packaged inference engine may need
   drivers that match your kernel. Try the CPU variant first
3. **Insufficient memory** — LLMs require significant RAM/VRAM. Check system
   resources with `free -h` and `nvidia-smi` (for NVIDIA)

## WSL2-Specific Issues

### Nix Daemon Not Starting

```bash
sudo systemctl enable nix-daemon
sudo systemctl start nix-daemon
```

If systemd is not enabled in WSL2, add to `/etc/wsl.conf`:

```ini
[boot]
systemd=true
```

Then restart WSL2: `wsl --shutdown` in PowerShell, then reopen.

### GPU Passthrough

For NVIDIA GPUs in WSL2, ensure you have the
[NVIDIA CUDA on WSL](https://developer.nvidia.com/cuda/wsl) driver installed
on the Windows host. The Nix CUDA packages will then work inside WSL2.

AMD ROCm is not currently supported in WSL2.

## Container Image Won't Load

**Symptom:** `./result | docker load` fails or produces an empty image.

**Check:**

1. Ensure you are on Linux (containers are Linux-only):
   ```bash
   uname -s    # should output "Linux"
   ```
2. Ensure Docker or Podman is running:
   ```bash
   docker info
   ```
3. Rebuild and try again:
   ```bash
   nix build .#openclaw-container && ./result | docker load
   ```

## MicroVM Won't Start

**Symptom:** `nix run .#openclaw-microvm` fails or QEMU exits immediately.

**Check KVM support:**

```bash
# KVM device must exist
ls -la /dev/kvm

# Your user must have access (typically via kvm group)
groups | grep kvm
```

**Fix:** If `/dev/kvm` is missing, your CPU may not support hardware
virtualization, or it may be disabled in BIOS/UEFI. Enable VT-x (Intel)
or AMD-V (AMD) in BIOS settings.

If the device exists but you lack permission:

```bash
sudo usermod -aG kvm $USER
# Log out and back in for the group change to take effect
```

**Port conflicts:** If the console ports (15500-15511) are already in use,
the VM may fail to start. Check with `ss -ltnp | grep 155`.

## MicroVM Console Not Connecting

**Symptom:** `socat -,rawer tcp:localhost:15501` hangs or refuses connection.

**Possible causes:**

1. **VM still booting** — wait a few seconds after starting the VM
2. **Wrong port** — gateway uses 15501 (virtio) or 15500 (serial);
   gateway-ollama uses 15511/15510. See [MicroVMs](microvm.md) for the
   full port table
3. **socat not installed** — install it via your system package manager or
   use `nc localhost 15500` for the serial console instead
