# 🌌 Orbit

Orbit is a premium, Fluent-designed Electron desktop application crafted to streamline local environment setup for developers utilizing **Antigravity IDE**, **OrbitPrompter**, and modern mobile/web dev tooling. 

Designed for high-performance pair-programming workflows, Orbit scaffolds configuration environments, verifies diagnostic statuses, runs automated instructions, and provides a beautiful control panel for active projects.

---

## ✨ Features

- **🚀 Dual-Mode Launch Sequence**:
  - *Express Launch*: Instant environment bootstrapping for standard developer stacks (Node.js, Git, Python 3, Supabase, EAS CLI, and OrbitPrompter configurations).
  - *Custom Payload*: Granular choice of toolchains, local directory paths, custom workflow instructions, and API keys.
- **🛡️ Live Diagnostics & Control Panel**:
  - Interactive grid detailing system presence and status for all active command-line interfaces.
  - One-click launch trigger to automatically initialize Antigravity IDE with Chrome DevTools Protocol (CDP) connectivity.
- **🤖 Autopilot Workspace Scaffolding**:
  - Automatically initializes conventional workspace scaffolding inside custom folders.
  - Pre-provisions agent guidelines (`~/.gemini/GEMINI.md`) and pre-built operational workflows (e.g., `feature.md`, `submit.md`, `test.md`).
- **🎛️ Integrated Bot Orchestrator**:
  - In-app GUI to configure, start, stop, and audit the **OrbitPrompter** bot (`remoat`) with customized access lists.
- **💎 Premium Fluent UI**:
  - Deep dark theme with glassmorphic elements, subtle glow animations, and Fluent 2 card designs.

---

## 🛠️ Architecture & Project Layout

```
├── electron/
│   ├── assets/              # Premium images, svgs, and logos
│   ├── main.js              # Electron main process (IPC handlers, process triggers)
│   ├── index.html           # Web app structure
│   ├── styles.css           # Fluent dark aesthetic design tokens & components
│   ├── motion.css           # Micro-interactions, animations, and transitions
│   ├── preload.cjs          # Context-isolated safe bridging
│   └── renderer.js          # DOM controllers & UI state management
├── lib/
│   ├── scaffold-templates.mjs # Global rules & workflow templates
│   ├── scaffold-io.mjs        # Filesystem writers
│   ├── workflows-io.mjs       # Custom workflows manager
│   └── antigravity-runtime.mjs# Shell-spawning runtime controllers
├── package.json
└── README.md
```

---

## 📋 System Prerequisites

Orbit compiles and executes on macOS, Windows, and Linux. Make sure you have the following installed locally:

- **Node.js** (v18.x or later recommended)
- **npm** (v9.x or later)
- **Git**

---

## 📦 Developer Quick-Start

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/YOUR_USERNAME/orbit.git
   cd orbit
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Run locally in development mode**:
   ```bash
   npm start
   ```

4. **Package local builds**:
   Generate installers customized for your host OS:
   ```bash
   npm run dist
   ```

---

## 🚀 Automated Release Pipeline (CI/CD)

Orbit is pre-configured with a robust multi-platform compiler utilizing **GitHub Actions** and `electron-builder`.

### How to Publish a Multi-Platform Release:

1. **Tag your release** with a semantic version (prefixed with `v`):
   ```bash
   git tag v1.0.0
   ```

2. **Push the tag** to your GitHub repository:
   ```bash
   git push origin v1.0.0
   ```

3. **Magic in the Clouds**: The GitHub Actions runner will automatically:
   - Compile a signed/optimized production bundle for **macOS** (outputting `.dmg` and `.zip`).
   - Compile a production installer for **Windows** (outputting `.exe`).
   - Create a clean **GitHub Draft Release** and upload all artifacts directly to the release page.

---

## 📄 License

This project is licensed under the MIT License.
