FROM ghcr.io/lavalink-devs/lavalink:4

# Keep Lavalink configuration inside the image to avoid host bind-mount
# filesystem issues (observed as YAML read deadlocks on Docker Desktop).
COPY application.yml /opt/Lavalink/application.yml
