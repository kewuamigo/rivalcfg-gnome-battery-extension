# Rivalcfg Battery Indicator Setup

This GNOME Shell extension uses `rivalcfg` to get battery information from your SteelSeries mouse device. For this to work, you need to install `rivalcfg`.

The recommended way to install `rivalcfg` is by using `pipx`.

## Installation

### 1. Install pipx

First, you need to install `pipx`. Open a terminal and run the command corresponding to your Linux distribution:

**Fedora, CentOS, RHEL:**
```bash
sudo dnf install pipx
```

**Debian, Ubuntu, and derivatives:**
```bash
sudo apt update
sudo apt install pipx
```

**Arch Linux:**
```bash
sudo pacman -Syu pipx
```

For other distributions, please refer to the [official pipx installation guide](https://pipx.pypa.io/stable/installation/).

### 2. Install rivalcfg

Once `pipx` is installed, use it to install `rivalcfg`. `pipx` installs packages in an isolated environment, which is safer.

```bash
pipx install rivalcfg
```
*(Note: Do not use `sudo` with `pipx install`, as it installs packages in the user's environment, not system-wide.)*

### 3. Update your PATH

The final step is to ensure that the system can find the `rivalcfg` command. `pipx` can do this for you.

```bash
pipx ensurepath
```

You may need to restart your terminal or session for the `PATH` changes to take effect. In some cases, you might need to log out and log back in.

After this, the extension should be able to find and use `rivalcfg`.
