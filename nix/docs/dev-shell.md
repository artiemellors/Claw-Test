# Development Shell

The dev shell (`nix develop`) provides a complete, reproducible toolchain for
OpenClaw development.

---

## What's Included

| Tool         | Version   | Purpose                              |
|--------------|-----------|--------------------------------------|
| Node.js      | 22.x      | JavaScript runtime (matches engines) |
| pnpm         | 10.x      | Package manager                      |
| Git          | latest    | Version control                      |
| Python 3     | 3.x       | Build scripts                        |
| pkg-config   | latest    | Native module compilation            |
| GNU Make     | latest    | Build system                         |
| ripgrep      | latest    | Fast code search                     |
| jp2a         | latest    | ASCII art banner                     |
| nixfmt-tree  | latest    | Nix file formatter                   |
| nil          | latest    | Nix language server (editor LSP)     |

All versions are pinned via `flake.lock` — every developer gets identical
tool versions regardless of their host OS.

## ASCII Art Welcome Banner

When you enter the dev shell, the OpenClaw lobster logo is displayed as colored
ASCII art in your terminal, followed by a quick-reference of available commands.

The banner uses [jp2a](https://github.com/cslarsen/jp2a) to convert
`docs/assets/openclaw-logo-text.png` to terminal-colored ASCII art. If `jp2a`
is not available or the image is missing, a plain text fallback is shown.

The banner module lives at `nix/shell-functions/ascii-art.nix`.

## Environment Variables

The dev shell sets the following environment variables:

| Variable      | Value                       | Purpose                     |
|---------------|-----------------------------|-----------------------------|
| `NODE_ENV`    | `development`               | Node.js development mode    |
| `RIPGREP_PATH`| Path to Nix ripgrep binary  | Used by OpenClaw internals  |

## Available Commands

Inside the dev shell, all standard OpenClaw development commands work:

```bash
# Dependencies
pnpm install                    # Install npm packages

# Build
pnpm build                      # Full build
pnpm dev                        # Run CLI in dev mode

# Verification (local dev gate)
pnpm check                      # Format + lint + typecheck
pnpm format                     # Check formatting (oxfmt)
pnpm format:fix                 # Fix formatting
pnpm lint                       # Lint (oxlint)
pnpm tsgo                       # TypeScript type checking

# Tests
pnpm test                       # Run full test suite
pnpm test:coverage              # With coverage report
pnpm test:fast                  # Fast unit tests only

# Nix-specific
nix fmt                          # Format Nix files
nix flake check                  # Run all Nix checks
```

## Customizing the Shell

The shell is defined in `nix/shell.nix` and pulls packages from
`nix/packages.nix`. To add a tool:

1. Add the package to the appropriate category list in `nix/packages.nix`
2. Run `nix develop` to pick up the change

`allPackages` is derived automatically from the category lists (`buildTools`,
`qualityTools`, `bannerTools`), so there is no separate list to update.

Example — adding `jq` to the quality tools:

```nix
# In nix/packages.nix, add to qualityTools:
qualityTools = [
  pkgs.ripgrep
  pkgs.nixfmt-tree
  pkgs.nil
  pkgs.jq        # <-- add here
];
```

## Updating Toolchain Versions

Tool versions are determined by the nixpkgs commit pinned in `flake.lock`.
To update:

```bash
nix run .#update-deps    # Updates flake.lock to latest nixpkgs unstable
nix fmt                  # Format any Nix file changes
```

Then commit `flake.lock`.
