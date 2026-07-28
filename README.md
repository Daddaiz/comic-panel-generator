# Comic Panel Generator

A SillyTavern extension that turns the latest message in your chat into a comic strip. It uses your connected LLM to break the scene into panels (visual description + dialogue), then generates an image for each panel through NanoGPT's image API (or any other image-generation server you connect) — with speech and thought balloons drawn on top.

## Requirements

- SillyTavern with an LLM connection already set up (used to write the panel breakdown).
- A NanoGPT API key (default provider), or your own image-generation server/software.

## Installation

**Option A — Install Extension:** In SillyTavern, go to Extensions → Install Extension, paste this repository's URL, confirm.

**Option B — Manual:** Copy the extension folder into `SillyTavern/public/scripts/extensions/third-party/`, then restart SillyTavern.

## Quick start

1. Open Extensions → **Comic Panel Generator** and expand **🔌 Image Provider**. Leave it on **NanoGPT** (default) and enter your API key under **🔑 API & Model**, or add your own server under **➕ Add new custom / local server**.
2. Pick a model, panel count, and comic style (generic / manga / Disney) under **🎬 Comic Settings**.
3. Click the wand icon (🪄) in the chat toolbar → **Generate comic**.
4. If "Review prompts before generating" is on, you can edit each panel's prompt before anything is generated.
5. Panels generate one by one in the **Comic generated** window.
6. In that window you can drag balloons anywhere, resize them, rotate their tail, double-click to edit their text, add new balloons (+), or delete them (✕). Use 🔁 on any panel to regenerate just that one.
7. Click **Insert** to post the finished comic into the chat, or **Export** to save it as a single image. Both strip out all editing tools first — only the artwork and balloons are included.

## Key settings to know about

- **Character & Persona References** — uses character/persona avatars as image references to keep faces consistent. "Use last generated panel as extra reference" and "Keep first generated image as a permanent reference" further improve consistency across panels and across the whole conversation.
- **Include clothing & art style in prompt text** — off by default; turn on if you want clothing/style spelled out in text instead of relying only on reference images.
- **Custom / local providers** — under Image Provider, you can connect any other HTTP image API (including local tools like a Fooocus-API server) by filling in its request template.

## Troubleshooting

- Nothing shows up after installing → fully restart SillyTavern (not just the browser page).
- Check the browser Console (F12) for `[Comic Panel Generator]` log lines — most errors are logged there with details.
