# nix/shell-functions/ascii-art.nix
#
# ASCII art logo display for the OpenClaw development shell.
# Uses jp2a to convert the OpenClaw logo to colored ASCII art.
# Falls back to a plain text banner if jp2a is not available.
#
# Usage in shell.nix:
#   asciiArt = import ./shell-functions/ascii-art.nix { };
#

_:

''
  if command -v jp2a >/dev/null 2>&1 && [ -f "./docs/assets/openclaw-logo-text-dark.png" ]; then
    jp2a --colors --width=80 ./docs/assets/openclaw-logo-text-dark.png 2>/dev/null || echo "OpenClaw Development Shell"
    echo ""
  elif command -v jp2a >/dev/null 2>&1 && [ -f "./docs/assets/openclaw-logo-text.png" ]; then
    jp2a --colors --width=80 ./docs/assets/openclaw-logo-text.png 2>/dev/null || echo "OpenClaw Development Shell"
    echo ""
  else
    echo "OpenClaw Development Shell"
    echo ""
  fi
''
