# Static Analysis Report

Initial baseline analysis of the OpenClaw codebase using the Nix analysis
suite. Run on 2026-04-07 against `main` branch (commit `6f159a9a28`).

This report establishes a baseline. No fixes are included in this PR.

---

## Summary

| Category       | Tool       | Status | Findings |
|----------------|------------|--------|----------|
| Nix            | statix     | PASS   | 0        |
| Nix            | deadnix    | PASS   | 0        |
| Nix            | nixfmt     | PASS   | 0        |
| TypeScript     | oxlint     | PASS   | 0 (6,127 files, 117 rules) |
| TypeScript     | biome      | INFO   | 9,725 (no config, uncalibrated) |
| Security       | trivy      | FAIL   | 73 vulns, 0 secrets, 12 misconfigs |
| Security       | gitleaks   | --     | (not yet run) |
| Security       | trufflehog | --     | (not yet run) |
| Code Quality   | shellcheck | FAIL   | ~40 findings across scripts/ |
| Code Quality   | shfmt      | FAIL   | Formatting diffs in several scripts |
| Code Quality   | actionlint | --     | (not yet run separately) |
| Code Quality   | typos      | --     | (not yet run separately) |
| Container      | hadolint   | FAIL   | 13 findings across 4 Dockerfiles |

## Nix Analysis (`nix run .#analyze-nix`)

**Status: PASS**

All three Nix tools pass clean on the `nix/` directory and `flake.nix`:

- **statix** (Nix linting): 0 warnings
- **deadnix** (unused Nix code): 0 findings
- **nixfmt** (formatting): All files formatted

## TypeScript Analysis (`nix run .#analyze-typescript`)

### oxlint

**Status: PASS** — 0 warnings, 0 errors.

```
Finished in 146ms on 6,127 files with 117 rules using 24 threads.
```

The project's primary linter. Already well-configured via `.oxlintrc.json`.

### biome

**Status: INFO** — 9,725 diagnostics (uncalibrated).

Biome ran without a `biome.json` config, so it applied its full default
ruleset. This is not actionable without calibration. If biome is adopted as a
supplementary linter, a `biome.json` should be created to suppress rules that
conflict with the project's oxlint configuration.

Breakdown: 7,711 errors, 1,485 warnings, 549 infos.

## Security Analysis (`nix run .#analyze-security`)

### trivy

**Status: FAIL** — 73 known vulnerabilities, 12 misconfigurations, 0 secrets.

| Target | Type | Vulns | Misconfigs |
|--------|------|-------|------------|
| `pnpm-lock.yaml` | pnpm | 6 | - |
| `vendor/a2ui/.../0.8/eval/pnpm-lock.yaml` | pnpm | 30 | - |
| `vendor/a2ui/.../0.9/eval/pnpm-lock.yaml` | pnpm | 30 | - |
| `vendor/a2ui/renderers/angular/package-lock.json` | npm | 6 | - |
| `vendor/a2ui/renderers/lit/package-lock.json` | npm | 1 | - |
| `scripts/k8s/manifests/deployment.yaml` | k8s | - | 12 |
| Dockerfiles (8 files) | dockerfile | - | 11 |
| Swift/Go lockfiles | swift/go | 0 | - |

**Key observations:**

- The 6 vulnerabilities in `pnpm-lock.yaml` are the only ones in project-owned
  code. The remaining 67 are in vendored `a2ui` lockfiles.
- The 12 Kubernetes misconfigurations are in `scripts/k8s/manifests/deployment.yaml`
  (likely hardening recommendations: resource limits, security contexts, etc.).
- The 11 Dockerfile misconfigurations overlap with hadolint findings below.
- Zero secrets detected.

### gitleaks / trufflehog

Not yet run in this report (trivy already covers secret scanning and found
zero). These can be run individually for deeper git-history scanning.

## Code Quality Analysis (`nix run .#analyze-quality`)

### shellcheck

**Status: FAIL** — ~40 findings across `scripts/` and `git-hooks/`.

**Most common issues:**

| Code | Severity | Count | Description |
|------|----------|-------|-------------|
| SC2148 | error | 8 | Missing shebang in sourced scripts |
| SC2164 | warning | 10 | `cd` without `|| exit` fallback |
| SC2086 | info | 6 | Unquoted variables in git commands |
| SC2059 | info | 4 | Variables in printf format strings |
| SC1091 | info | 4 | Sourced file not specified as input |
| SC2054 | warning | 1 | Commas instead of spaces in array |
| SC2163 | warning | 1 | `export "$key"` does not export the variable |
| SC2259 | error | 1 | Redirection overrides piped input |
| SC2015 | info | 1 | `A && B || C` is not if-then-else |
| SC1078 | warning | 3 | False positive on JS inside heredoc |

**Files with most findings:**

- `scripts/pr-lib/worktree.sh` — 5 (`cd` without fallback)
- `scripts/pr-lib/push.sh` — 6 (unquoted variables)
- `scripts/e2e/onboard-docker.sh` — 5 (JS heredoc false positives)
- `scripts/clawdock/clawdock-helpers.sh` — 3 (`cd` without fallback)
- `scripts/build-and-run-mac.sh` — 4 (printf format strings)

**Note:** Several findings in `scripts/e2e/onboard-docker.sh` are false
positives where shellcheck parses embedded JavaScript inside a bash heredoc.

### shfmt

**Status: FAIL** — Formatting diffs in several scripts.

At least `scripts/termux-quick-auth.sh` has indentation inconsistencies
(spaces vs tabs in case statements).

### actionlint / typos / codespell

Not yet run separately in this report. Available via `nix run .#analyze-quality`.

## Container Analysis (`nix run .#analyze-container`)

### hadolint

**Status: FAIL** — 13 findings across 4 Dockerfiles.

| File | Findings |
|------|----------|
| `Dockerfile` | 8 |
| `Dockerfile.sandbox` | 1 |
| `Dockerfile.sandbox-browser` | 1 |
| `Dockerfile.sandbox-common` | 3 |

**Breakdown by rule:**

| Rule | Severity | Count | Description |
|------|----------|-------|-------------|
| DL3008 | warning | 7 | Unpinned `apt-get install` versions |
| DL4006 | warning | 3 | Missing `set -o pipefail` before piped RUN |
| DL3006 | warning | 1 | Untagged base image |
| DL3016 | warning | 1 | Unpinned `npm install` version |
| DL3059 | info | 1 | Consecutive RUN instructions |

## Documentation Analysis (`nix run .#analyze-docs`)

Not yet run. Available for markdown linting and broken link detection.

## Supply Chain Analysis (`nix run .#analyze-supply-chain`)

Not yet run. Available for SBOM generation and license compliance scanning.

---

## Recommendations (Future PRs)

### Quick Wins

1. **shellcheck SC2148**: Add shebangs to sourced library scripts in
   `scripts/pr-lib/` (8 files, trivial fix)
2. **hadolint DL3008**: Pin apt package versions in Dockerfiles
3. **hadolint DL4006**: Add `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` to
   Dockerfiles

### Medium Effort

4. **shellcheck SC2164**: Add `|| exit` after `cd` calls in scripts
5. **trivy vulns**: Triage the 6 pnpm-lock vulnerabilities in project-owned
   code
6. **trivy k8s**: Review the 12 Kubernetes deployment hardening findings

### Investigate

7. **vendored a2ui**: 60 of 73 trivy vulnerabilities are in vendored lockfiles.
   Determine if these are actively used or can be updated/removed.
8. **biome adoption**: If supplementary linting is desired, create a calibrated
   `biome.json` config.

---

## How to Reproduce

```bash
# Run individual categories
nix run .#analyze-nix
nix run .#analyze-typescript
nix run .#analyze-security
nix run .#analyze-quality
nix run .#analyze-container
nix run .#analyze-docs
nix run .#analyze-supply-chain

# Run everything
nix run .#analyze
```
