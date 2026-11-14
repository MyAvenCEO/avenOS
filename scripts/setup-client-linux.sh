#!/usr/bin/env bash
set -euo pipefail

sudo apt-get update
# Ubuntu 26.04 renamed webkit2gtk-driver to webkitgtk-webdriver.
webdriver_package=webkit2gtk-driver
if [[ "$(apt-cache policy webkitgtk-webdriver)" == *"Candidate: "[0-9]* ]]; then
	webdriver_package=webkitgtk-webdriver
fi
sudo apt-get install --yes build-essential libwebkit2gtk-4.1-dev libsoup-3.0-dev libasound2-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf libfuse2 libxdo-dev "$webdriver_package" xvfb dbus
cargo install tauri-driver --version 2.0.6 --locked
