#!/bin/bash
# Pelican AI entrypoint
# Links shared skills into the OpenClaw workspace, then starts the gateway.

SKILLS_SRC="/home/openclaw/.openclaw/skills-shared"
SKILLS_DST="/data/skills"

# Link shared skills into the persistent volume (if they exist)
if [ -d "$SKILLS_SRC" ] && [ -d "/data" ]; then
    mkdir -p "$SKILLS_DST"
    for skill_dir in "$SKILLS_SRC"/*/; do
        if [ -d "$skill_dir" ]; then
            skill_name=$(basename "$skill_dir")
            # Copy skill if it doesn't already exist (don't overwrite client customisations)
            if [ ! -d "$SKILLS_DST/$skill_name" ]; then
                cp -r "$skill_dir" "$SKILLS_DST/$skill_name"
                echo "[pelican] Installed shared skill: $skill_name"
            fi
        fi
    done
fi

# Start the gateway
exec openclaw gateway run --bind lan --port 3000
