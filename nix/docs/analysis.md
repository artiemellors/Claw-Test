# Static Analysis

The Nix flake provides 45 static analysis tools organized into 7 categories.
All tools are pinned via `flake.lock` — every developer runs the same versions.

No manual installation required. Run any analysis with a single `nix run`
command.

---

## Quick Start

```bash
# Run everything
nix run .#analyze

# Run a specific category
nix run .#analyze-security

# Enter a shell with all tools available
nix develop .#analysis
```

## Available Targets

| Target                      | Category        | Tools                                             |
|-----------------------------|-----------------|----------------------------------------------------|
| `nix run .#analyze`              | All             | Runs all categories below                          |
| `nix run .#analyze-nix`          | Nix             | statix, deadnix, nixfmt                           |
| `nix run .#analyze-typescript`   | TypeScript/JS   | oxlint, biome                                      |
| `nix run .#analyze-security`     | Security        | trivy, grype, gitleaks, trufflehog                 |
| `nix run .#analyze-quality`      | Code Quality    | shellcheck, shfmt, actionlint, typos, codespell   |
| `nix run .#analyze-container`    | Container       | hadolint                                           |
| `nix run .#analyze-docs`         | Documentation   | markdownlint-cli2, markdown-link-check             |
| `nix run .#analyze-supply-chain` | Supply Chain    | syft, license-scanner                              |

## Tool Reference

### Nix Linting (`analyze-nix`)

| Tool       | Purpose                                    |
|------------|--------------------------------------------|
| `statix`   | Lints Nix code, suggests improvements      |
| `deadnix`  | Finds unused variables and imports in Nix   |
| `nixfmt`   | Checks Nix formatting (nixfmt-tree)        |
| `nil`      | Nix LSP for editor integration             |

### TypeScript / JavaScript (`analyze-typescript`)

| Tool       | Purpose                                    |
|------------|--------------------------------------------|
| `oxlint`   | Fast Rust-based linter (project primary)   |
| `biome`    | All-in-one formatter and linter            |
| `eslint`   | Traditional JS/TS linter                   |
| `eslint_d` | eslint daemon for faster repeated runs     |

### Security Scanning (`analyze-security`)

| Tool         | Purpose                                  |
|--------------|------------------------------------------|
| `trivy`      | Vulnerability scanner (fs, config, secrets) |
| `grype`      | Dependency vulnerability scanner         |
| `syft`       | SBOM generator (also in supply-chain)    |
| `semgrep`    | Pattern-based static analysis            |
| `gitleaks`   | Detects secrets in git history           |
| `trufflehog` | Finds verified secrets across sources    |

### Code Quality (`analyze-quality`)

| Tool         | Purpose                                  |
|--------------|------------------------------------------|
| `shellcheck` | Static analysis for shell scripts        |
| `shfmt`      | Shell script formatter                   |
| `actionlint` | GitHub Actions workflow linter           |
| `typos`      | Fast source code spell checker           |
| `typos-lsp`  | LSP server for typos (editor integration)|
| `codespell`  | Python-based spell checker               |
| `vale`       | Prose linter for documentation           |
| `vale-ls`    | LSP server for vale (editor integration) |

### Container (`analyze-container`)

| Tool       | Purpose                                    |
|------------|--------------------------------------------|
| `hadolint` | Dockerfile best practices linter           |
| `dockle`   | Container image security linter            |

### Documentation (`analyze-docs`)

| Tool                  | Purpose                             |
|-----------------------|-------------------------------------|
| `markdownlint-cli2`   | Markdown style and correctness      |
| `markdownlint-cli`    | Classic markdown linter             |
| `markdown-link-check` | Detects broken links in markdown    |

### Supply Chain (`analyze-supply-chain`)

| Tool                | Purpose                               |
|---------------------|---------------------------------------|
| `syft`              | SBOM generator (CycloneDX, SPDX)     |
| `cosign`            | Container/artifact signing            |
| `licensee`          | License detection and compliance      |
| `license-scanner`   | Scans dependencies for license info   |
| `npm-check-updates` | Interactive npm dependency updater    |

## Analysis Dev Shell

For interactive use of all tools, enter the analysis shell:

```bash
nix develop .#analysis
```

This provides the standard dev shell tools (Node 22, pnpm, etc.) plus all 45
analysis tools on `$PATH`. Useful for:

- Running individual tools manually with custom flags
- Integrating tools into editor configs
- Exploratory security audits

## Adding Tools

Analysis modules live in `nix/analysis/`. Each category is a separate file
that returns `{ packages, runner }`.

To add a new tool to an existing category, add it to both `packages` (for the
dev shell) and `runtimeInputs` in the `writeShellApplication` runner.

To add a new category:

1. Create `nix/analysis/my-category.nix` following the existing pattern
2. Import it in `nix/analysis/default.nix`
3. Add it to the `categories` set and `runners` output
4. Add the corresponding `analyze-my-category` app in `flake.nix`

## CI Integration

Run all analysis in CI:

```yaml
- uses: cachix/install-nix-action@v27
- run: nix run .#analyze
```

Or run specific categories:

```yaml
- run: nix run .#analyze-security
- run: nix run .#analyze-quality
```
