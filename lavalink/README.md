# Lavalink Setup

This directory contains the Lavalink server configuration. The binary and plugins are not included in the repository and must be downloaded separately.

## Required Files

### 1. Lavalink.jar (v4.1.1)
Download from: https://github.com/lavalink-devs/Lavalink/releases/tag/4.1.1

```bash
cd lavalink
curl -L -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/download/4.1.1/Lavalink.jar
```

### 2. Plugins

Download the following plugins to the `plugins/` directory:

#### YouTube Plugin
```bash
mkdir -p plugins
cd plugins
curl -L -o youtube-plugin.jar https://github.com/lavalink-devs/youtube-source/releases/latest/download/youtube-plugin.jar
```

#### LavaSrc Plugin (Spotify, Apple Music, Deezer support)
```bash
curl -L -o lavasrc-plugin-4.8.1.jar https://github.com/topi314/LavaSrc/releases/download/4.8.1/lavasrc-plugin-4.8.1.jar
```

#### LavaSearch Plugin
```bash
curl -L -o lavasearch-plugin-1.0.0.jar https://github.com/topi314/LavaSearch/releases/download/1.0.0/lavasearch-plugin-1.0.0.jar
```

#### SponsorBlock Plugin
```bash
curl -L -o sponsorblock-plugin-3.0.1.jar https://github.com/topi314/Sponsorblock-Plugin/releases/download/v3.0.1/sponsorblock-plugin-3.0.1.jar
```

#### LavaLyrics Plugin
```bash
curl -L -o lavalyrics-plugin-1.1.0.jar https://github.com/topi314/LavaLyrics/releases/download/1.1.0/lavalyrics-plugin-1.1.0.jar
```

## Quick Setup Script

Run this script to download all required files:

```bash
#!/bin/bash
cd lavalink

# Download Lavalink
echo "Downloading Lavalink v4.1.1..."
curl -L -o Lavalink.jar https://github.com/lavalink-devs/Lavalink/releases/download/4.1.1/Lavalink.jar

# Create plugins directory
mkdir -p plugins
cd plugins

# Download plugins
echo "Downloading plugins..."
curl -L -o youtube-plugin.jar https://github.com/lavalink-devs/youtube-source/releases/latest/download/youtube-plugin.jar
curl -L -o lavasrc-plugin-4.8.1.jar https://github.com/topi314/LavaSrc/releases/download/4.8.1/lavasrc-plugin-4.8.1.jar
curl -L -o lavasearch-plugin-1.0.0.jar https://github.com/topi314/LavaSearch/releases/download/1.0.0/lavasearch-plugin-1.0.0.jar
curl -L -o sponsorblock-plugin-3.0.1.jar https://github.com/topi314/Sponsorblock-Plugin/releases/download/v3.0.1/sponsorblock-plugin-3.0.1.jar
curl -L -o lavalyrics-plugin-1.1.0.jar https://github.com/topi314/LavaLyrics/releases/download/1.1.0/lavalyrics-plugin-1.1.0.jar

echo "Lavalink setup complete!"
```

## Running Lavalink

After downloading the files, you can start Lavalink:

```bash
cd lavalink
java -jar Lavalink.jar
```

Or use the main project's development script:

```bash
pnpm dev:all
```

## Configuration

The `application.yml` file contains the Lavalink configuration. Make sure to set your environment variables before starting:

- `LAVALINK_PASSWORD` - Password for Lavalink authentication
- Spotify credentials (if using Spotify features)
- Other plugin-specific credentials

See the root `.env.example` file for all required environment variables.
