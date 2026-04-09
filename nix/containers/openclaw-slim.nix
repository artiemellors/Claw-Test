# nix/containers/openclaw-slim.nix
#
# Optimized openclaw package with unnecessary runtime closure stripped.
#
# Problem: nixpkgs nodejs-slim embeds Nix store path references to 12+
# -dev header packages in its binary. These are build-time artifacts that
# the node runtime never loads, but their presence pulls them into the
# runtime closure — inflating containers from ~200 MB to ~2.3 GB.
#
# Solution: use nukeReferences to zero out ALL store path references from
# the node binary, then selectively re-add only the runtime-essential
# references via a wrapper that sets the necessary library paths.
#
# Actually, the simplest correct approach: scan the binary for store
# paths matching unwanted patterns and use remove-references-to on each.
#
{
  pkgs,
  lib,
  openclaw,
}:
let
  nodejs = pkgs.nodejs_22;
  nodejs-slim = pkgs.nodejs-slim_22;

  # Patterns identifying packages to strip. Matched against the basename
  # of store paths found embedded in the node binary.
  stripPatterns = [
    "-dev/"
    "-dev\""
    "-static"
    "bash-interactive"
    "coreutils-"
    "gnugrep-"
  ];

  # Create a stripped copy of nodejs-slim.
  # Instead of listing packages by attribute (which may not match the exact
  # store paths embedded in the binary), we scan the binary for /nix/store/
  # paths and strip those matching unwanted patterns.
  nodejs-slim-stripped =
    pkgs.runCommand "nodejs-slim-stripped-${nodejs-slim.version}"
      {
        nativeBuildInputs = [
          pkgs.removeReferencesTo
        ];
      }
      ''
        # Copy only what's needed at runtime: bin/ and lib/ (skip include/)
        mkdir -p $out/bin $out/lib
        cp -a ${nodejs-slim}/bin/* $out/bin/
        cp -a ${nodejs-slim}/lib/* $out/lib/ 2>/dev/null || true
        chmod -R u+w $out

        # Extract all unique store paths from ALL output files and strip
        # unwanted ones (dev headers, build tools, static libs)
        ${pkgs.gnugrep}/bin/grep -raoP '/nix/store/[a-z0-9]{32}-[^\x00"/, ]+' $out/ 2>/dev/null \
          | ${pkgs.coreutils}/bin/cut -d: -f2 \
          | sort -u \
          | while read -r storepath; do
            name=$(basename "$storepath")
            case "$name" in
              *-dev|*-dev.*|*-static|*-static.*|*-bin|*-bin.*|bash-interactive*|coreutils-*|gnugrep-*)
                echo "  Stripping: $name"
                find $out -type f -exec remove-references-to -t "$storepath" {} + 2>/dev/null || true
                ;;
            esac
          done

        # Strip the self-reference to the original nodejs-slim. The node binary
        # embeds its own prefix path, which chains back to all -dev packages.
        echo "  Stripping original nodejs-slim self-reference"
        find $out -type f -exec remove-references-to -t ${nodejs-slim} {} + 2>/dev/null || true

        echo "=== Remaining store references ==="
        ${pkgs.gnugrep}/bin/grep -raoP '/nix/store/[a-z0-9]{32}-[^\x00"/, ]+' $out/ 2>/dev/null \
          | ${pkgs.coreutils}/bin/cut -d: -f2 \
          | sort -u \
          | while read -r p; do echo "  $(basename "$p")"; done || true
      '';

in
{
  # Stripped nodejs for container use — no -dev headers in closure
  inherit nodejs-slim-stripped;

  # Stripped openclaw package — uses the stripped nodejs
  openclaw-slim =
    pkgs.runCommand "openclaw-slim-${openclaw.version}"
      {
        nativeBuildInputs = [ pkgs.removeReferencesTo ];
        meta = openclaw.meta // {
          description = "OpenClaw (container-optimized — stripped build-time closure)";
        };
      }
      ''
        cp -a ${openclaw} $out
        chmod -R u+w $out

        # Rewrite wrapper scripts to use stripped nodejs and self-reference
        if [ -d $out/bin ]; then
          for f in $out/bin/*; do
            if [ -f "$f" ] && head -1 "$f" | grep -q '#!'; then
              substituteInPlace "$f" \
                --replace-quiet "${nodejs-slim}" "${nodejs-slim-stripped}" \
                --replace-quiet "${nodejs}" "${nodejs-slim-stripped}" \
                --replace-quiet "${openclaw}/lib" "$out/lib" \
                --replace-quiet "${openclaw}" "$out"
            fi
          done
        fi

        # Strip references to the original (fat) nodejs and openclaw packages
        find $out -type f -exec remove-references-to -t ${nodejs} {} + 2>/dev/null || true
        find $out -type f -exec remove-references-to -t ${nodejs-slim} {} + 2>/dev/null || true
        find $out -type f -exec remove-references-to -t ${openclaw} {} + 2>/dev/null || true
      '';
}
