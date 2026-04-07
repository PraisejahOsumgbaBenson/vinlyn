# Vinlyn

An interactive, gesture-driven digital art gallery that transforms how you browse and experience artworks. Built with React and TypeScript, Vinlyn presents a 3D card-stack interface for exploring pieces from the Art Institute of Chicago collection, complete with hand-gesture controls, spatial audio feedback, and a curated gallery aesthetic.

## Features

- **3D Card Stack Gallery** — Drag through a perspective-warped stack of artwork cards with momentum-based scrolling and smooth easing animations
- **Hand Gesture Controls** — Enable camera-based hand tracking (via MediaPipe) to scroll and select artworks without touching the screen
- **Spatial Audio Feedback** — Subtle Web Audio API sound effects for taps, drags, hovers, and gallery reveals
- **Artwork Detail Pages** — Deep-dive into individual pieces with artist info, medium, dimensions, historical context, and auto-extracted color palettes
- **Favorites & Collections** — Save artworks to favorites, create named collections, and manage them from the gallery view
- **Dual Layout Modes** — Switch between the immersive drag view and a traditional grid layout
- **Smart Search** — Combined search across the Art Institute of Chicago API and Wikipedia for paintings, artists, and movements
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

### Build for Production

```bash
npm run build
npm run preview
```

### Linting

```bash
npm run lint
```

## Project Structure

```
src/
├── App.tsx                        # Main application shell and state orchestration
├── App.css                        # Global styles and layout
├── components/
│   ├── AlbumRibbon.tsx            # 3D card stack with drag, hover, and gesture support
│   ├── AlbumRibbon.css            # Card stack styling and 3D transforms
│   └── HandGestureController.tsx  # MediaPipe hand landmark detection and gesture mapping
├── lib/
│   ├── index.ts                   # Public API exports
│   ├── artworks.ts                # Art Institute of Chicago + Wikipedia API integration
│   └── sfx.ts                     # Procedural UI sound synthesis via Web Audio API
└── main.tsx                       # Application entry point
```

## Architecture

### Gallery Engine

The `AlbumRibbon` component renders a virtualized 3D card stack using CSS `transform3d` with perspective rotation. Cards are positioned along a diagonal axis with depth-based scaling, z-index layering, and side-face thickness for a physical card metaphor. The scroll physics use a target/animated offset pattern with configurable drag response, settle easing, and release momentum.

### Gesture Pipeline

`HandGestureController` loads the MediaPipe vision bundle as a local blob URL, initializes a `HandLandmarker` model, and runs a `requestAnimationFrame` loop on the webcam feed. Index finger Y-delta maps to scroll velocity, while thumb-index pinch distance triggers selection with a 500ms debounce.

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
| `Escape` | Clear search |
| `P` | Open source picker |
| `R` | Refresh gallery |

## License

MIT
