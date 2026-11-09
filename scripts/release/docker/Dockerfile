# SkillForge image built from the release archive (no sources, no build step).
# Experimental in 0.2.0: the build host has no Docker, so this file is not verified. Run from the release root:
#   docker build -f docker/Dockerfile -t skillforge:<version> .
FROM node:24-alpine
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    SKILLFORGE_HOST=0.0.0.0 \
    SKILLFORGE_PORT=8080 \
    SKILLFORGE_DATA_DIR=/data
VOLUME /data
EXPOSE 8080
CMD ["node", "packages/server/dist/index.js"]
