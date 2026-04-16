FROM node:22-slim

# Install pinned version of OpenClaw
RUN npm install -g openclaw@2026.4.9

# Create non-root user
RUN useradd -m -s /bin/bash openclaw
USER openclaw

# Set up directories
RUN mkdir -p /home/openclaw/.openclaw

# Expose gateway port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start gateway
CMD ["openclaw", "gateway", "run", "--bind", "lan", "--port", "3000"]
