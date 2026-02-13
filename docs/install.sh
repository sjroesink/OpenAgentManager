#!/bin/sh
# OpenAgentManager installer for macOS and Linux
# Usage: curl -fsSL https://sjroesink.github.io/OpenAgentManager/install.sh | sh

set -e

REPO="sjroesink/OpenAgentManager"
NAME="OpenAgentManager"

echo ""
echo "  Installing $NAME..."
echo ""

# Detect OS
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64)  ARCH="x64" ;;
  aarch64) ARCH="arm64" ;;
  arm64)   ARCH="arm64" ;;
  *)
    echo "  Error: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

case "$OS" in
  Darwin)
    PLATFORM="mac"
    EXT="dmg"
    ;;
  Linux)
    PLATFORM="linux"
    EXT="AppImage"
    ;;
  *)
    echo "  Error: Unsupported OS: $OS (use install.ps1 for Windows)"
    exit 1
    ;;
esac

FILENAME="$NAME-$PLATFORM-$ARCH.$EXT"
URL="https://github.com/$REPO/releases/latest/download/$FILENAME"
OUTFILE="/tmp/$FILENAME"

echo "  Downloading $FILENAME..."
curl -fSL "$URL" -o "$OUTFILE"

if [ "$OS" = "Darwin" ]; then
  echo "  Opening DMG..."
  open "$OUTFILE"
  echo ""
  echo "  Done! Drag OpenAgentManager to your Applications folder."
else
  chmod +x "$OUTFILE"
  INSTALL_DIR="$HOME/.local/bin"
  mkdir -p "$INSTALL_DIR"
  mv "$OUTFILE" "$INSTALL_DIR/$NAME.AppImage"
  echo ""
  echo "  Installed to $INSTALL_DIR/$NAME.AppImage"
  echo "  Run it with: $NAME.AppImage"

  # Add to PATH hint if needed
  case ":$PATH:" in
    *":$INSTALL_DIR:"*) ;;
    *)
      echo ""
      echo "  Tip: Add $INSTALL_DIR to your PATH:"
      echo "    export PATH=\"\$HOME/.local/bin:\$PATH\""
      ;;
  esac
fi

echo ""
echo "  Done!"
echo ""
