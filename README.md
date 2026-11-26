# Vinlyn

[![GitHub stars](https://img.shields.io/github/stars/PraisejahOsumgbaBenson/vinlyn)](https://github.com/PraisejahOsumgbaBenson/vinlyn/stargazers)
[![GitHub license](https://img.shields.io/github/license/PraisejahOsumgbaBenson/vinlyn)](https://github.com/PraisejahOsumgbaBenson/vinlyn/blob/main/LICENSE)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5.0-646CFF?logo=vite)](https://vitejs.dev)

An interactive, gesture-driven digital art gallery that transforms how you browse and experience artworks. Built with React and TypeScript, Vinlyn presents a 3D card-stack interface for exploring pieces from the Art Institute of Chicago collection, complete with hand-gesture controls, spatial audio feedback, and a curated gallery aesthetic.

## Features

- **3D Card Stack Gallery** — Drag through a perspective-warped stack of artwork cards with momentum-based scrolling and smooth easing animations
- **Hand Gesture Controls** — Enable camera-based hand tracking (via MediaPipe) to move the 3D stack in drag view, scroll the page in grid view, and select the front artwork by pinching. The camera preview draws the tracked hand joints, a finger guide line, and tracking status.
- **Spatial Audio Feedback** — Subtle Web Audio API sound effects for taps, drags, hovers, and gallery reveals
- **Artwork Detail Pages** — Deep-dive into individual pieces with artist info, medium, dimensions, historical context, and auto-extracted color palettes
- **Favorites & Collections** — Save artworks to favorites, create named collections, and manage them from the gallery view
- **Dual Layout Modes** — Switch between the immersive drag view and a traditional grid layout
- **Personal Gallery Name** (Your name is saved in this browser, used on the welcome screen, and suggested as the default collection name. Change it from the header at any time.)
- **Guided Controls** (The About dialog explains gestures and shortcuts. The source label in the filter panel opens the source picker.)
- **Smart Search** (Search paintings, artists, and movements across the Art Institute of Chicago API and Wikipedia. Search matches artwork titles, artists, and styles, so "monalisa" finds the Mona Lisa instead of unrelated works. Wikipedia results are limited to art and art movements, never biographies or celebrity photos. Sexual or body-focused queries are blocked with a "We can't share that" message. The source picker also has a Painting Search mode with its own search term.)
- **Historical Collection** (The gallery shows paintings, prints, and sculptures made by 1900. Photographs, modern styles, and works that depict nudity are left out.)
- **Reliable Images** (Artwork images use a size that fits each source, stepping down to smaller sizes when a source image is too small.)
- **Fast Loading** (Artwork pages load in parallel, requests time out instead of hanging, and a local cache keeps the gallery ready on return visits. Only the first eight drag cards load images eagerly.)
- **Responsive Design** — Adaptive card sizing and layout for desktop and mobile viewports
- **Offline-Ready Static Assets** — MediaPipe vision runtime bundled locally for reliable gesture detection

## Tech Stack

- **React 19** with TypeScript
- **Vite** for development and bundling
- **MediaPipe Tasks Vision** for real-time hand landmark detection
- **Web Audio API** for procedural UI sound synthesis
- **Art Institute of Chicago API** for artwork metadata and images
- **Wikipedia API** as a supplementary art information source
- **CSS** with custom properties for 3D transforms and theming

## Table of Contents

- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
  - [Gallery Engine](#gallery-engine)
  - [Gesture Pipeline](#gesture-pipeline)
  - [API Layer](#api-layer)
  - [Audio System](#audio-system)
- [Environment Variables](#environment-variables)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [License](#license)

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/PraisejahOsumgbaBenson/vinlyn.git
cd vinlyn

# Install dependencies
npm install

# Start the development server
npm run dev
```

For mobile device access on your local network:

```bash
npm run dev:phone
```

When opened from `localhost` or `127.0.0.1`, the app routes Art Institute API and IIIF image requests through Vite's dev and preview servers. The museum's Cloudflare rules reject requests that carry a localhost `Referer`, so the local proxy replaces it with an allowed one. Deployed builds continue to call the museum directly.

### Build for Production

```bash
npm run build
npm run preview
```

### Linting

```bash
npm run lint
```

### Testing

```bash
bun test
```

## Project Structure

```
src/
├── App.tsx                        # Main application shell and state orchestration
├── App.css                        # Global styles and layout
├── components/
│   ├── AlbumRibbon.tsx            # 3D card stack with drag, hover, and gesture support
│   ├── AlbumRibbon.css            # Card stack styling and 3D transforms
│   └── HandGestureController.tsx  # Camera frames, gesture mapping, and scroll dispatch
├── lib/
│   ├── index.ts                   # Public API exports
│   ├── artworks.ts                # Art Institute of Chicago + Wikipedia API integration
│   ├── artworks.test.ts           # Tests for historical and blocked-search rules
│   ├── gestureEvents.ts           # Gesture scroll bridge and selection sequence gate
│   ├── gestureEvents.test.ts      # Tests for gesture enable and pinch sequencing
│   ├── gestureMath.ts             # Smoothing, deadband, delta clamp, and pinch hysteresis
│   ├── gestureMath.test.ts        # Tests for gesture signal handling
│   ├── gestureMessages.ts         # Worker message and landmark types
│   ├── gestureOverlay.ts          # Camera preview hand map and tracking status text
│   ├── gestureOverlay.test.ts     # Tests for hand map status text
│   └── sfx.ts                     # Procedural UI sound synthesis via Web Audio API
└── main.tsx                       # Application entry point
```

The classic gesture worker and MediaPipe runtime live in `public/`. They are served as plain files so the worker can load the runtime with `importScripts`.

## Architecture

### Gallery Engine

The `AlbumRibbon` component renders a virtualized 3D card stack using CSS `transform3d` with perspective rotation. Cards are positioned along a diagonal axis with depth-based scaling, z-index layering, and side-face thickness for a physical card metaphor. The scroll physics use a target/animated offset pattern with configurable drag response, settle easing, and release momentum.

### Gesture Pipeline

`HandGestureController` watches the camera for new frames, then hands each frame to a classic web worker. The worker loads the locally bundled MediaPipe runtime with `importScripts`, starts `HandLandmarker` with GPU inference and a CPU fallback, and sends back one landmark sample per frame. `gestureOverlay.ts` draws those landmarks on the camera preview with a finger guide line, pinch indicator, and tracking status. `gestureMath.ts` smooths the index finger position, ignores small jitter, clamps large steps, and uses a hand-relative pinch ratio with release hysteresis and a 500ms selection debounce. It requires an open hand before a pinch can select, so a resting hand does not open an artwork. The ribbon ignores the first selection value it receives, so enabling gestures never opens the front artwork by mistake. Scroll deltas travel through a small event bridge. Drag view applies them directly to `AlbumRibbon` without re-rendering the app shell, and grid view scrolls the document.

### API Layer

Artwork data flows from two sources:
- **Art Institute of Chicago** — Primary source for high-resolution images, metadata, and collection browsing
- **Wikipedia** — Supplementary source for artist context and artwork descriptions

Both are unified under a common `AlbumCover` / `SpotifyAlbumDetail` type system, with pagination handled through safe batched requests (20 items per page, capped at 240 results).

### Audio System

`UiSfx` generates all sounds procedurally using oscillators — no audio files required. Each interaction type (tap, confirm, hover, drag scrub, reveal, error) maps to a unique frequency envelope with configurable attack, release, and frequency slide parameters.

## Environment Variables

Create a `.env` file from the example:

```bash
cp .env.example .env
```

| Variable | Description | Required |
|---|---|---|
| `VITE_SPOTIFY_CLIENT_ID` | Placeholder for future Spotify integration | No |
| `VITE_SPOTIFY_REDIRECT_URI` | OAuth redirect override | No |

The application works out of the box with the Art Institute of Chicago public API — no API key required.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `/` | Focus search input |
| `Enter` | Submit the focused search or load the chosen source |
| `Escape` | Clear search |
| `P` | Open source picker |
| `R` | Refresh gallery |

## License

MIT
