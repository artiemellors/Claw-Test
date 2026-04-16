FROM node:22-slim

# Install pinned version of OpenClaw
RUN npm install -g openclaw@2026.4.9

# Create non-root user
RUN useradd -m -s /bin/bash openclaw

# Copy shared skills into the image (available to all clients)
COPY --chown=openclaw:openclaw skills-shared/ /home/openclaw/.openclaw/skills-shared/

# Copy the entrypoint script
COPY --chown=openclaw:openclaw entrypoint.sh /home/openclaw/entrypoint.sh
RUN chmod +x /home/openclaw/entrypoint.sh

USER openclaw

# Set up directories
RUN mkdir -p /home/openclaw/.openclaw

# Expose gateway port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start via entrypoint (links skills, then runs gateway)
ENTRYPOINT ["/home/openclaw/entrypoint.sh"]
