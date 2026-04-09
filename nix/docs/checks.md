# Checks

The Nix flake wraps OpenClaw's existing verification gates as `nix flake check`
derivations. This lets CI and contributors run the same checks in a
reproducible Nix environment.

---

## Running Checks

```bash
nix flake check
```

This runs all enabled checks. Individual checks can be built directly:

```bash
nix build .#checks.x86_64-linux.check-format
nix build .#checks.x86_64-linux.check-lint
nix build .#checks.x86_64-linux.check-test
```

## Available Checks

| Check          | What It Runs     | Maps To              |
|----------------|------------------|----------------------|
| `check-format` | Nix file formatting | `nixfmt --check`    |
| `check-lint`   | Full verification gate | `pnpm check`    |
| `check-test`   | Test suite       | `pnpm test`          |
| `shell`        | Dev shell builds | Validates `nix develop` works |

### Mapping to OpenClaw Gates

| OpenClaw Gate | Nix Check      | Description                        |
|---------------|----------------|------------------------------------|
| Local dev     | `check-lint`   | `pnpm check` (format + lint + types) |
| Landing bar   | `check-test`   | `pnpm test`                        |
| Nix format    | `check-format` | `nixfmt --check flake.nix nix/`    |

## CI Integration

In a GitHub Actions workflow:

```yaml
- uses: cachix/install-nix-action@v27
  with:
    nix_path: nixpkgs=channel:nixos-unstable
- run: nix flake check
```

## Adding a New Check

Checks are defined in `nix/checks.nix`. To add a new one:

```nix
# In nix/checks.nix, add to the returned set:
check-build = mkCheck "build" "build" { };
```

The `mkCheck` helper creates a derivation that runs a pnpm script inside a
Nix sandbox with all dependencies available.

## pnpmDeps Hash

The `check-lint` and `check-test` checks require a pre-fetched pnpm dependency
hash. When `pnpm-lock.yaml` changes, update the hash:

1. Set the hash to empty in `flake.nix`
2. Run `nix build .#pnpmDeps`
3. Copy the correct hash from the error message
4. Update `flake.nix` with the new hash

See [Troubleshooting](troubleshooting.md#pnpmdeps-hash-mismatch) for details.
