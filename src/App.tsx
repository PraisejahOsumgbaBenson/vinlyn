import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { AlbumRibbon } from "./components/AlbumRibbon";
import { HandGestureController } from "./components/HandGestureController";
import {
  beginSpotifyLogin,
  consumeOAuthCallbackIfPresent,
  fetchAlbumDetail,
  fetchLikedTrackAlbumCovers,
  fetchPlaylistAlbumCovers,
  fetchSavedAlbumCovers,
  fetchUserPlaylists,
  getValidAccessToken,
  isSpotifyConfigured,
  searchArtworkCovers,
  type LibrarySource,
  type AlbumCover,
  type SpotifyAlbumDetail,
  type SpotifyPlaylist,
} from "./lib";
import { UiSfx } from "./lib/sfx";
import "./App.css";

const SOURCE_KEY = "vinlyn_source_choice";
const PLAYLIST_KEY = "vinlyn_source_playlist";
const NICKNAME_KEY = "vinlyn_nickname";
const LAYOUT_KEY = "vinlyn_layout_mode";
const FAVORITES_KEY = "vinlyn_favorite_ids";
const COLLECTIONS_KEY = "vinlyn_collections";
const GALLERY_SCOPE_KEY = "vinlyn_gallery_scope";

type LayoutMode = "drag" | "grid";
type PaletteColor = { hex: string; label: string };
type GalleryScope = "all" | "favorites" | "collection";
type UserCollection = {
  id: string;
  name: string;
  artworkIds: string[];
};

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function artworkIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/artwork\/([^/]+)$/);
  if (!match?.[1]) return null;
  return decodeURIComponent(match[1]);
}

function sourceLabel(source: LibrarySource): string {
  if (source === "saved-albums") return "Featured";
  if (source === "liked-songs") return "Paintings";
  return "Movement";
}

function loadStoredSource(): LibrarySource {
  const raw = localStorage.getItem(SOURCE_KEY);
  if (raw === "saved-albums" || raw === "liked-songs" || raw === "playlist") {
    return raw;
  }
  return "saved-albums";
}

function toHex(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v)))
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    default:
      h = (rn - gn) / d + 4;
      break;
  }
  h /= 6;

  return { h: h * 360, s, l };
}

function labelFromColor(r: number, g: number, b: number): string {
  const { h, s, l } = rgbToHsl(r, g, b);
  if (l < 0.16) return "Ink Black";
  if (l > 0.88 && s < 0.2) return "Ivory";
  if (s < 0.12) return l > 0.55 ? "Stone Gray" : "Graphite";
  if (h < 20 || h >= 345) return "Crimson";
  if (h < 45) return "Burnt Orange";
  if (h < 70) return "Ochre";
  if (h < 160) return "Olive Green";
  if (h < 210) return "Teal";
  if (h < 260) return "Slate Blue";
  if (h < 320) return "Muted Violet";
  return "Dusty Rose";
}

function fallbackPalette(): PaletteColor[] {
  return [
    { hex: "#C8B89C", label: "Canvas Beige" },
    { hex: "#7E8A8E", label: "Dust Blue" },
    { hex: "#A87358", label: "Terra Cotta" },
    { hex: "#3E4B52", label: "Charcoal" },
  ];
}

async function extractImagePalette(imageUrl: string): Promise<PaletteColor[]> {
  if (typeof window === "undefined" || !imageUrl) return fallbackPalette();

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const size = 56;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          resolve(fallbackPalette());
          return;
        }

        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        const bins = new Map<
          string,
          { r: number; g: number; b: number; count: number }
        >();

        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] ?? 0;
          if (a < 160) continue;
          const r = data[i] ?? 0;
          const g = data[i + 1] ?? 0;
          const b = data[i + 2] ?? 0;

          const rq = Math.round(r / 32) * 32;
          const gq = Math.round(g / 32) * 32;
          const bq = Math.round(b / 32) * 32;
          const key = `${rq},${gq},${bq}`;

          const prev = bins.get(key);
          if (prev) {
            prev.count += 1;
          } else {
            bins.set(key, { r: rq, g: gq, b: bq, count: 1 });
          }
        }

        const sorted = [...bins.values()]
          .map((entry) => {
            const { s, l } = rgbToHsl(entry.r, entry.g, entry.b);
            const vividness = 0.45 + s * 1.1 + (0.5 - Math.abs(l - 0.5));
            return { ...entry, score: entry.count * vividness };
          })
          .sort((a, b) => b.score - a.score);

        const chosen: Array<{ r: number; g: number; b: number }> = [];
        for (const swatch of sorted) {
          const tooClose = chosen.some((c) => {
            const dr = c.r - swatch.r;
            const dg = c.g - swatch.g;
            const db = c.b - swatch.b;
            return dr * dr + dg * dg + db * db < 2600;
          });
          if (tooClose) continue;
          chosen.push({ r: swatch.r, g: swatch.g, b: swatch.b });
          if (chosen.length >= 5) break;
        }

        if (chosen.length < 3) {
          resolve(fallbackPalette());
          return;
        }

        resolve(
          chosen.map((c) => ({
            hex: rgbToHex(c.r, c.g, c.b),
            label: labelFromColor(c.r, c.g, c.b),
          })),
        );
      } catch {
        resolve(fallbackPalette());
      }
    };

    img.onerror = () => resolve(fallbackPalette());
    img.src = imageUrl;
  });
}

function firstSentence(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  const match = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] || cleaned).trim();
}

function buildArtworkStory(detail: SpotifyAlbumDetail): string {
  const dateText = detail.releaseDate || "an unknown period";
  const movementText = detail.genres[0] || "a distinct artistic language";
  const artistText = detail.artists[0]?.name || "an unknown artist";
  const historyLead = firstSentence(detail.history);
  const meaningLead = firstSentence(detail.meaning);

  return [
    `${detail.name} was created by ${artistText} around ${dateText}, and reflects ${movementText.toLowerCase()} through its ${detail.medium.toLowerCase()}.`,
    historyLead,
    meaningLead,
  ]
    .filter(Boolean)
    .join(" ");
}

export default function App() {
  const [albums, setAlbums] = useState<AlbumCover[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [introLoading, setIntroLoading] = useState(true);
  const [nicknameInput, setNicknameInput] = useState("");
  const [nickname, setNickname] = useState<string>(() => {
    return sessionStorage.getItem(NICKNAME_KEY) || "";
  });
  const [nicknameDone, setNicknameDone] = useState<boolean>(() => {
    return Boolean(sessionStorage.getItem(NICKNAME_KEY));
  });
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<LibrarySource>(() =>
    loadStoredSource(),
  );
  const [pickerSource, setPickerSource] = useState<LibrarySource>(() =>
    loadStoredSource(),
  );
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<AlbumCover[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeAlbum, setActiveAlbum] = useState<AlbumCover | null>(null);
  const [activeAlbumDetail, setActiveAlbumDetail] =
    useState<SpotifyAlbumDetail | null>(null);
  const [albumDetailLoading, setAlbumDetailLoading] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string>(() => {
    return localStorage.getItem(PLAYLIST_KEY) || "";
  });
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw === "grid" ? "grid" : "drag";
  });
  const [currentPath, setCurrentPath] = useState(
    () => window.location.pathname,
  );
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [gestureStatus, setGestureStatus] = useState<string | null>(null);
  const [gestureScroll, setGestureScroll] = useState({ seq: 0, delta: 0 });
  const [gestureSelectSeq, setGestureSelectSeq] = useState(0);
  const [imagePalette, setImagePalette] = useState<PaletteColor[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(() =>
    parseJson<string[]>(localStorage.getItem(FAVORITES_KEY), []),
  );
  const [collections, setCollections] = useState<UserCollection[]>(() =>
    parseJson<UserCollection[]>(localStorage.getItem(COLLECTIONS_KEY), []),
  );
  const [newCollectionName, setNewCollectionName] = useState("");
  const [collectionRenameName, setCollectionRenameName] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState("");
  const [galleryScope, setGalleryScope] = useState<GalleryScope>(() => {
    const raw = localStorage.getItem(GALLERY_SCOPE_KEY);
    return raw === "favorites" || raw === "collection" ? raw : "all";
  });
  const [galleryCollectionId, setGalleryCollectionId] = useState("");
  const [similarArtworks, setSimilarArtworks] = useState<AlbumCover[]>([]);
  const sfxRef = useRef<UiSfx | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const detailRequestTokenRef = useRef<string | null>(null);
  const configured = isSpotifyConfigured();
  const routeArtworkId = artworkIdFromPath(currentPath);
  const isArtworkPage = Boolean(routeArtworkId);

  const getSfx = () => {
    if (!sfxRef.current) {
      sfxRef.current = new UiSfx();
    }
    return sfxRef.current;
  };

  const resumeSfx = () => {
    void getSfx().resume();
  };

  const loadFromSpotify = useCallback(
    async (sourceOverride?: LibrarySource) => {
      const source = sourceOverride ?? selectedSource;
      setLoading(true);
      setStatus(null);
      try {
        const token = await getValidAccessToken();
        if (!token) {
          setConnected(false);
          setAlbums([]);
          setStatus("Click + to open the art collection.");
          return;
        }
        setConnected(true);
        let list: AlbumCover[] = [];

        if (source === "saved-albums") {
          list = await fetchSavedAlbumCovers(token);
        } else if (source === "liked-songs") {
          list = await fetchLikedTrackAlbumCovers(token);
        } else {
          const pl = await fetchUserPlaylists(token);
          setPlaylists(pl);

          if (!pl.length) {
            setAlbums([]);
            setStatus("No art movements available right now.");
            return;
          }

          let playlistId = selectedPlaylistId;
          if (
            !playlistId ||
            !pl.some((p: SpotifyPlaylist) => p.id === playlistId)
          ) {
            playlistId = pl[0]!.id;
            setSelectedPlaylistId(playlistId);
            setSourcePickerOpen(true);
            setStatus("Choose a movement, then click Load.");
            setAlbums([]);
            return;
          }

          list = await fetchPlaylistAlbumCovers(token, playlistId);
        }

        setAlbums(list);
        if (!list.length) {
          setStatus(`No artworks found in ${sourceLabel(source)}.`);
        } else {
          getSfx().playReveal();
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Could not load artworks";
        setStatus(msg);
        setAlbums([]);
        getSfx().playError();
      } finally {
        setLoading(false);
      }
    },
    [selectedPlaylistId, selectedSource],
  );

  useEffect(() => {
    const t = window.setTimeout(() => setIntroLoading(false), 1100);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    localStorage.setItem(SOURCE_KEY, selectedSource);
  }, [selectedSource]);

  useEffect(() => {
    if (!sourcePickerOpen || pickerSource !== "playlist" || !connected) return;
    if (playlists.length > 0) return;

    let cancelled = false;
    void (async () => {
      const token = await getValidAccessToken();
      if (!token || cancelled) return;
      try {
        const pl = await fetchUserPlaylists(token);
        if (cancelled) return;
        setPlaylists(pl);
        if (!selectedPlaylistId && pl[0]?.id) {
          setSelectedPlaylistId(pl[0].id);
        }
      } catch {
        if (!cancelled) {
          setStatus("Could not load playlists right now.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    connected,
    pickerSource,
    playlists.length,
    selectedPlaylistId,
    sourcePickerOpen,
  ]);

  useEffect(() => {
    if (selectedPlaylistId) {
      localStorage.setItem(PLAYLIST_KEY, selectedPlaylistId);
    }
  }, [selectedPlaylistId]);

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, layoutMode);
  }, [layoutMode]);

  useEffect(() => {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
    localStorage.setItem(GALLERY_SCOPE_KEY, galleryScope);
  }, [galleryScope]);

  useEffect(() => {
    localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(collections));
    if (!collections.length) {
      setSelectedCollectionId("");
      return;
    }
    if (
      !selectedCollectionId ||
      !collections.some((c) => c.id === selectedCollectionId)
    ) {
      setSelectedCollectionId(collections[0]?.id || "");
    }
  }, [collections, selectedCollectionId]);

  useEffect(() => {
    if (!collections.length) {
      setGalleryCollectionId("");
      if (galleryScope === "collection") {
        setGalleryScope("all");
      }
      return;
    }

    if (
      !galleryCollectionId ||
      !collections.some((c) => c.id === galleryCollectionId)
    ) {
      setGalleryCollectionId(collections[0]?.id || "");
    }
  }, [collections, galleryCollectionId, galleryScope]);

  useEffect(() => {
    const onPopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!nicknameDone) return;
      try {
        await consumeOAuthCallbackIfPresent();
      } catch (e) {
        if (!cancelled) {
          setStatus(e instanceof Error ? e.message : "Sign-in failed");
        }
      }
      if (!cancelled) await loadFromSpotify();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadFromSpotify, nicknameDone]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (isTyping && e.key !== "Escape") return;

      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (e.key === "Escape" && searchQuery) {
        setSearchQuery("");
        return;
      }

      if ((e.key === "p" || e.key === "P") && nicknameDone && configured) {
        e.preventDefault();
        setPickerSource(selectedSource);
        setSourcePickerOpen(true);
        return;
      }

      if ((e.key === "r" || e.key === "R") && connected) {
        e.preventDefault();
        void loadFromSpotify();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    configured,
    connected,
    loadFromSpotify,
    nicknameDone,
    searchQuery,
    selectedSource,
  ]);

  const onConnect = () => {
    if (!nicknameDone) return;
    resumeSfx();
    getSfx().playTap();
    setStatus(null);
    setPickerSource(selectedSource);
    setSourcePickerOpen(true);
  };

  const onNicknameSubmit = (e: FormEvent) => {
    e.preventDefault();
    const next = nicknameInput.trim().slice(0, 8);
    if (!next) return;
    resumeSfx();
    getSfx().playConfirm();
    setNickname(next);
    setNicknameDone(true);
    sessionStorage.setItem(NICKNAME_KEY, next);
  };

  const onSourceConfirm = () => {
    resumeSfx();
    getSfx().playConfirm();
    const chosenSource = pickerSource;
    setGalleryScope("all");
    setSelectedSource(chosenSource);
    localStorage.setItem(SOURCE_KEY, chosenSource);

    if (
      chosenSource === "playlist" &&
      !selectedPlaylistId &&
      playlists[0]?.id
    ) {
      setSelectedPlaylistId(playlists[0].id);
    }

    setStatus(null);
    if (!connected) {
      setSourcePickerOpen(false);
      void beginSpotifyLogin();
      return;
    }

    if (
      chosenSource === "playlist" &&
      playlists.length > 0 &&
      !selectedPlaylistId
    ) {
      setStatus("Choose a playlist, then click Load.");
      return;
    }

    setSourcePickerOpen(false);
    void loadFromSpotify(chosenSource);
  };

  const onRefreshPage = () => {
    resumeSfx();
    getSfx().playTap();
    window.location.reload();
  };

  const onOpenSourcePicker = () => {
    resumeSfx();
    getSfx().playTap();
    setGalleryScope("all");
    setPickerSource(selectedSource);
    setSourcePickerOpen(true);
  };

  const onToggleCollectionScope = () => {
    setGalleryScope((prev) => (prev === "collection" ? "all" : "collection"));
  };

  const onToggleLayout = () => {
    resumeSfx();
    getSfx().playTap();
    setLayoutMode((prev) => (prev === "drag" ? "grid" : "drag"));
  };

  const onToggleGestures = () => {
    resumeSfx();
    getSfx().playTap();
    setGestureEnabled((prev) => {
      const next = !prev;
      if (!next) {
        setGestureStatus(null);
      }
      return next;
    });
  };

  const onGestureScroll = useCallback((deltaY: number) => {
    setGestureScroll((prev) => ({ seq: prev.seq + 1, delta: deltaY }));
  }, []);

  const onGestureSelect = useCallback(() => {
    setGestureSelectSeq((prev) => prev + 1);
  }, []);

  const onGestureStateChange = useCallback(
    (state: "idle" | "ready" | "error", message?: string) => {
      if (state === "idle") {
        setGestureStatus(null);
        return;
      }
      if (state === "ready") {
        setGestureStatus(message || "Camera gestures enabled");
        return;
      }
      setGestureStatus(message || "Could not enable camera gestures");
      setStatus(message || "Could not enable camera gestures");
    },
    [],
  );

  const toggleFavorite = () => {
    const artworkId = activeAlbumDetail?.id || activeAlbum?.id;
    if (!artworkId) return;
    setFavoriteIds((prev) =>
      prev.includes(artworkId)
        ? prev.filter((id) => id !== artworkId)
        : [...prev, artworkId],
    );
  };

  const removeFavoriteById = (artworkId: string) => {
    setFavoriteIds((prev) => prev.filter((id) => id !== artworkId));
  };

  const createCollection = () => {
    const name = newCollectionName.trim();
    if (!name) return;
    const id = `col-${Date.now().toString(36)}`;
    setCollections((prev) => [...prev, { id, name, artworkIds: [] }]);
    setSelectedCollectionId(id);
    setNewCollectionName("");
  };

  const addToCollection = () => {
    const artworkId = activeAlbumDetail?.id || activeAlbum?.id;
    if (!artworkId || !selectedCollectionId) return;

    setCollections((prev) =>
      prev.map((collection) => {
        if (collection.id !== selectedCollectionId) return collection;
        if (collection.artworkIds.includes(artworkId)) return collection;
        return {
          ...collection,
          artworkIds: [...collection.artworkIds, artworkId],
        };
      }),
    );
  };

  const renameCollection = (collectionId: string) => {
    const nextName = collectionRenameName.trim();
    if (!nextName) return;
    setCollections((prev) =>
      prev.map((collection) =>
        collection.id === collectionId
          ? { ...collection, name: nextName }
          : collection,
      ),
    );
  };

  const deleteCollection = (collectionId: string) => {
    const target = collections.find((c) => c.id === collectionId);
    if (!target) return;
    const approved = window.confirm(
      `Delete collection "${target.name}" and all items saved in it?`,
    );
    if (!approved) return;
    setCollections((prev) => prev.filter((c) => c.id !== collectionId));
    if (selectedCollectionId === collectionId) {
      setSelectedCollectionId("");
    }
    if (galleryCollectionId === collectionId) {
      setGalleryCollectionId("");
    }
  };

  const removeFromCollection = (collectionId: string, artworkId: string) => {
    setCollections((prev) =>
      prev.map((collection) => {
        if (collection.id !== collectionId) return collection;
        return {
          ...collection,
          artworkIds: collection.artworkIds.filter((id) => id !== artworkId),
        };
      }),
    );
  };

  const navigateTo = (path: string) => {
    if (window.location.pathname === path) return;
    window.history.pushState({}, "", path);
    setCurrentPath(path);
  };

  const closeAlbumDetail = () => {
    detailRequestTokenRef.current = null;
    setActiveAlbum(null);
    setActiveAlbumDetail(null);
    setAlbumDetailLoading(false);
    if (window.location.pathname !== "/") {
      navigateTo("/");
    }
  };

  const loadArtworkDetail = useCallback(
    async (album: AlbumCover) => {
      if (albumDetailLoading && activeAlbum?.id === album.id) {
        return;
      }

      const requestToken = `${album.id}:${Date.now()}`;
      detailRequestTokenRef.current = requestToken;
      setActiveAlbum(album);
      setActiveAlbumDetail(null);
      setAlbumDetailLoading(true);

      try {
        const token = await getValidAccessToken();
        if (!token) {
          setStatus("Open the art collection to view artwork details.");
          return;
        }
        const detail = await fetchAlbumDetail(token, album.id);
        if (detailRequestTokenRef.current !== requestToken) return;
        setActiveAlbumDetail(detail);
      } catch (e) {
        if (detailRequestTokenRef.current !== requestToken) return;
        const msg =
          e instanceof Error ? e.message : "Could not load artwork details";
        setStatus(msg);
      } finally {
        if (detailRequestTokenRef.current === requestToken) {
          setAlbumDetailLoading(false);
        }
      }
    },
    [activeAlbum?.id, albumDetailLoading],
  );

  const onSelectAlbum = async (album: AlbumCover) => {
    resumeSfx();
    getSfx().playTap();
    navigateTo(`/artwork/${encodeURIComponent(album.id)}`);
    await loadArtworkDetail(album);
  };

  useEffect(() => {
    if (!routeArtworkId) return;
    if (
      activeAlbum?.id === routeArtworkId &&
      activeAlbumDetail?.id === routeArtworkId
    ) {
      return;
    }

    const known =
      albums.find((item) => item.id === routeArtworkId) ||
      (searchResults ?? []).find((item) => item.id === routeArtworkId) ||
      activeAlbum;

    if (known && known.id === routeArtworkId) {
      void loadArtworkDetail(known);
      return;
    }

    // Handle direct URL loads when the artwork is not in local ribbon data.
    void loadArtworkDetail({
      id: routeArtworkId,
      name: "Artwork",
      artist: "Unknown Artist",
      imageUrl: "",
    });
  }, [
    activeAlbum,
    activeAlbumDetail,
    albums,
    loadArtworkDetail,
    routeArtworkId,
    searchResults,
  ]);

  const formatReleaseDate = (value: string): string => {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const normalizedSearch = searchQuery.trim().toLowerCase();
  useEffect(() => {
    if (!nicknameDone || !connected) return;

    if (!normalizedSearch) {
      setSearchResults(null);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setSearchLoading(true);
        try {
          const token = await getValidAccessToken();
          if (!token || cancelled) return;
          const results = await searchArtworkCovers(
            token,
            normalizedSearch,
            true,
          );
          if (!cancelled) {
            setSearchResults(results);
          }
        } catch (e) {
          if (!cancelled) {
            const msg =
              e instanceof Error ? e.message : "Could not search paintings";
            setStatus(msg);
          }
        } finally {
          if (!cancelled) {
            setSearchLoading(false);
          }
        }
      })();
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [connected, nicknameDone, normalizedSearch]);

  useEffect(() => {
    let cancelled = false;
    const url = activeAlbumDetail?.imageUrl || activeAlbum?.imageUrl || "";

    if (!url) {
      setImagePalette([]);
      return;
    }

    void (async () => {
      const palette = await extractImagePalette(url);
      if (!cancelled) {
        setImagePalette(palette);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeAlbum?.imageUrl,
    activeAlbumDetail?.id,
    activeAlbumDetail?.imageUrl,
  ]);

  useEffect(() => {
    let cancelled = false;

    if (!activeAlbumDetail?.id || !connected) {
      setSimilarArtworks([]);
      return;
    }

    const query =
      activeAlbumDetail.artists[0]?.name ||
      activeAlbumDetail.genres[0] ||
      activeAlbumDetail.name;

    if (!query) {
      setSimilarArtworks([]);
      return;
    }

    void (async () => {
      try {
        const token = await getValidAccessToken();
        if (!token || cancelled) return;
        const results = await searchArtworkCovers(token, query);
        if (cancelled) return;
        setSimilarArtworks(
          results
            .filter((item) => item.id !== activeAlbumDetail.id)
            .slice(0, 8),
        );
      } catch {
        if (!cancelled) {
          setSimilarArtworks([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeAlbumDetail, connected]);

  const baseAlbums = searchResults ?? albums;
  const favoriteLibrary = albums.filter((item) =>
    favoriteIds.includes(item.id),
  );
  const artworkLookup = new Map(albums.map((item) => [item.id, item]));
  const activeGalleryCollection = collections.find(
    (c) => c.id === galleryCollectionId,
  );
  const activeCollectionItems = (activeGalleryCollection?.artworkIds || []).map(
    (id) => ({
      id,
      album: artworkLookup.get(id) || null,
    }),
  );
  const scopedAlbums =
    galleryScope === "favorites"
      ? baseAlbums.filter((item) => favoriteIds.includes(item.id))
      : galleryScope === "collection"
        ? baseAlbums.filter((item) => {
            return Boolean(
              activeGalleryCollection?.artworkIds.includes(item.id),
            );
          })
        : baseAlbums;
  const visibleAlbums = scopedAlbums;
  const hasSearchQuery = normalizedSearch.length > 0;
  const showLibrary = connected && visibleAlbums.length > 0;
  const showEmptyState =
    nicknameDone &&
    connected &&
    (albums.length > 0 || hasSearchQuery || galleryScope !== "all") &&
    visibleAlbums.length === 0;
  const emptyState = (() => {
    if (searchLoading && hasSearchQuery) {
      return {
        message: "Searching paintings...",
        action: null as null | "clear-search" | "show-all",
      };
    }

    if (galleryScope === "favorites") {
      if (!favoriteIds.length) {
        return {
          message:
            "No favorites yet. Open an artwork and save it to favorites.",
          action: null as null | "clear-search" | "show-all",
        };
      }
      if (hasSearchQuery) {
        return {
          message: `No favorite paintings match "${searchQuery}".`,
          action: "clear-search" as const,
        };
      }
      return {
        message: "No favorite artworks in this view.",
        action: "show-all" as const,
      };
    }

    if (galleryScope === "collection") {
      if (!collections.length) {
        return {
          message:
            "No collections yet. Create one from an artwork detail page.",
          action: null as null | "clear-search" | "show-all",
        };
      }
      if (!activeGalleryCollection) {
        return {
          message: "Select a collection to view saved artworks.",
          action: null as null | "clear-search" | "show-all",
        };
      }
      if (hasSearchQuery) {
        return {
          message: `No artworks in "${activeGalleryCollection.name}" match "${searchQuery}".`,
          action: "clear-search" as const,
        };
      }
      return {
        message: `"${activeGalleryCollection.name}" has no artworks yet.`,
        action: "show-all" as const,
      };
    }

    if (hasSearchQuery) {
      return {
        message: `No paintings match "${searchQuery}".`,
        action: "clear-search" as const,
      };
    }

    return {
      message: "No artworks available right now.",
      action: null as null | "clear-search" | "show-all",
    };
  })();
  const countText = `${visibleAlbums.length}`;
  const sourceInitial = sourceLabel(selectedSource).charAt(0).toUpperCase();
  const activeArtworkId = activeAlbumDetail?.id || activeAlbum?.id || "";
  const isFavorited = activeArtworkId
    ? favoriteIds.includes(activeArtworkId)
    : false;
  const activeCollection = collections.find(
    (c) => c.id === selectedCollectionId,
  );
  const inSelectedCollection = Boolean(
    activeArtworkId && activeCollection?.artworkIds.includes(activeArtworkId),
  );
  const storyText = activeAlbumDetail
    ? buildArtworkStory(activeAlbumDetail)
    : "";
  const colorCombination = activeAlbumDetail ? imagePalette : [];

  useEffect(() => {
    setCollectionRenameName(activeGalleryCollection?.name || "");
  }, [activeGalleryCollection?.id, activeGalleryCollection?.name]);

  return (
    <div
      className={`shell${layoutMode === "grid" && !isArtworkPage ? " shell--grid" : ""}`}
    >
      {!isArtworkPage && (
        <>
          <header className="unveil-nav unveil-nav--tl">
            <span className="unveil-pill unveil-pill--lead">
              VINLYN • GALLERY
            </span>
            <button type="button" className="unveil-pill">
              CONTACT
            </button>
          </header>

          <div className="unveil-corner unveil-corner--tr">
            {configured ? (
              <button
                type="button"
                className="unveil-thumb unveil-thumb--accent"
                title="Open"
                onClick={onConnect}
                disabled={!nicknameDone}
              >
                +
              </button>
            ) : (
              <span
                className="unveil-thumb unveil-thumb--ghost"
                title="Art API mode"
              >
                ·
              </span>
            )}
          </div>

          <aside className="unveil-filters" aria-label="Filters">
            <button
              type="button"
              className={`unveil-filter${galleryScope === "all" ? " unveil-filter--on" : ""}`}
              onClick={() => setGalleryScope("all")}
            >
              ALL <sup>{countText}</sup>
            </button>
            <button
              type="button"
              className={`unveil-filter${galleryScope === "favorites" ? " unveil-filter--on" : ""}`}
              onClick={() => setGalleryScope("favorites")}
              disabled={!favoriteIds.length}
            >
              FAVORITES <sup>{favoriteIds.length}</sup>
            </button>
            {galleryScope === "favorites" && favoriteLibrary.length > 0 && (
              <div
                className="unveil-favorites-panel"
                aria-label="Manage favorites"
              >
                {favoriteLibrary.map((item) => (
                  <div className="unveil-favorites-item" key={item.id}>
                    <button
                      type="button"
                      className="unveil-favorites-open"
                      onClick={() => void onSelectAlbum(item)}
                    >
                      {item.name}
                    </button>
                    <button
                      type="button"
                      className="unveil-favorites-delete"
                      onClick={() => removeFavoriteById(item.id)}
                      aria-label={`Remove ${item.name} from favorites`}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              className={`unveil-filter${galleryScope === "collection" ? " unveil-filter--on" : ""}`}
              onClick={onToggleCollectionScope}
              disabled={!collections.length}
            >
              COLLECTION <sup>{collections.length}</sup>
            </button>
            {galleryScope === "collection" && collections.length > 0 && (
              <>
                <select
                  className="unveil-collection-select"
                  value={galleryCollectionId}
                  onChange={(e) => setGalleryCollectionId(e.target.value)}
                  aria-label="Choose saved collection"
                >
                  {collections.map((collection) => (
                    <option key={collection.id} value={collection.id}>
                      {collection.name}
                    </option>
                  ))}
                </select>
                {activeGalleryCollection && (
                  <div className="unveil-collection-manage">
                    <input
                      className="unveil-collection-rename-input"
                      type="text"
                      value={collectionRenameName}
                      onChange={(e) => setCollectionRenameName(e.target.value)}
                      placeholder="Rename collection"
                      aria-label="Rename selected collection"
                    />
                    <div className="unveil-collection-manage-actions">
                      <button
                        type="button"
                        className="unveil-collection-action"
                        onClick={() =>
                          renameCollection(activeGalleryCollection.id)
                        }
                        disabled={!collectionRenameName.trim()}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="unveil-collection-action unveil-collection-action--danger"
                        onClick={() =>
                          deleteCollection(activeGalleryCollection.id)
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                )}
                {activeGalleryCollection &&
                  activeCollectionItems.length > 0 && (
                    <div
                      className="unveil-favorites-panel"
                      aria-label="Manage collection artworks"
                    >
                      {activeCollectionItems.map((item) => (
                        <div className="unveil-favorites-item" key={item.id}>
                          <button
                            type="button"
                            className="unveil-favorites-open"
                            onClick={() =>
                              item.album && void onSelectAlbum(item.album)
                            }
                            disabled={!item.album}
                            title={
                              item.album
                                ? item.album.name
                                : "Artwork unavailable in current source"
                            }
                          >
                            {item.album?.name || "Saved artwork"}
                          </button>
                          <button
                            type="button"
                            className="unveil-favorites-delete"
                            onClick={() =>
                              removeFromCollection(
                                activeGalleryCollection.id,
                                item.id,
                              )
                            }
                            aria-label={`Remove ${item.album?.name || "artwork"} from collection`}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
              </>
            )}
            <button type="button" className="unveil-filter">
              {sourceLabel(selectedSource).toUpperCase()}{" "}
              <sup>{connected ? "●" : "—"}</sup>
            </button>
            <button
              type="button"
              className="unveil-filter"
              onClick={onOpenSourcePicker}
              disabled={!configured || !nicknameDone}
            >
              SOURCE <sup>{sourceInitial}</sup>
            </button>
            <button
              type="button"
              className="unveil-filter"
              onClick={onRefreshPage}
              disabled={loading}
            >
              {loading ? "LOADING…" : "REFRESH"}
            </button>
            <button
              type="button"
              className="unveil-filter"
              onClick={onToggleLayout}
              disabled={!nicknameDone || !connected}
            >
              VIEW <sup>{layoutMode === "drag" ? "DRAG" : "GRID"}</sup>
            </button>
            <button
              type="button"
              className="unveil-filter"
              onClick={onToggleGestures}
              disabled={
                !nicknameDone ||
                !connected ||
                isArtworkPage ||
                layoutMode !== "drag"
              }
              title="Allow camera hand gestures for drag view"
            >
              GESTURE <sup>{gestureEnabled ? "ON" : "OFF"}</sup>
            </button>
            <div className="unveil-search">
              <input
                ref={searchInputRef}
                className="unveil-search__input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for painting or artist"
                aria-label="Search for painting or artist"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="unveil-search__clear"
                  onClick={() => setSearchQuery("")}
                  aria-label="Clear search"
                >
                  Clear
                </button>
              )}
            </div>
          </aside>
        </>
      )}

      {(status || gestureStatus) && !isArtworkPage && (
        <div className="toast" role="status">
          {status || gestureStatus}
        </div>
      )}

      {sourcePickerOpen && !isArtworkPage && (
        <div
          className="source-picker"
          role="dialog"
          aria-modal="true"
          aria-label="Choose gallery source"
        >
          <div className="source-picker__card">
            <div className="source-picker__title">Load Artworks From</div>
            <div className="source-picker__choices">
              <button
                type="button"
                className={`source-picker__choice${pickerSource === "saved-albums" ? " is-selected" : ""}`}
                onClick={() => setPickerSource("saved-albums")}
              >
                Featured Collection
              </button>
              <button
                type="button"
                className={`source-picker__choice${pickerSource === "liked-songs" ? " is-selected" : ""}`}
                onClick={() => setPickerSource("liked-songs")}
              >
                Painting Search
              </button>
              <button
                type="button"
                className={`source-picker__choice${pickerSource === "playlist" ? " is-selected" : ""}`}
                onClick={() => setPickerSource("playlist")}
              >
                Movement
              </button>
            </div>

            {pickerSource === "playlist" &&
              connected &&
              playlists.length > 0 && (
                <label
                  className="source-picker__playlist"
                  htmlFor="playlist-select"
                >
                  <span>Choose movement</span>
                  <select
                    id="playlist-select"
                    value={selectedPlaylistId}
                    onChange={(e) => setSelectedPlaylistId(e.target.value)}
                  >
                    {playlists.map((pl) => (
                      <option key={pl.id} value={pl.id}>
                        {pl.name} ({pl.tracksTotal})
                      </option>
                    ))}
                  </select>
                </label>
              )}

            {pickerSource === "playlist" && !connected && (
              <div className="source-picker__note">
                You can switch movement after opening the gallery.
              </div>
            )}

            <div className="source-picker__actions">
              <button
                type="button"
                className="source-picker__cancel"
                onClick={() => setSourcePickerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="source-picker__confirm"
                onClick={onSourceConfirm}
              >
                {connected ? "Load" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      )}

      {!configured && !isArtworkPage && (
        <div className="hint">
          Art collection API unavailable.
          <a
            href="https://api.artic.edu/docs/"
            target="_blank"
            rel="noreferrer"
          >
            api.artic.edu/docs
          </a>
          .
        </div>
      )}

      {!nicknameDone ? (
        <div className="intro-gate" aria-live="polite">
          {introLoading ? (
            <div className="intro-loading">
              <span className="intro-loading__dot" aria-hidden />
              <span>Loading experience...</span>
            </div>
          ) : (
            <form className="nick-form" onSubmit={onNicknameSubmit}>
              <label htmlFor="nickname-input">Enter your nickname</label>
              <div className="nick-form__row">
                <input
                  id="nickname-input"
                  value={nicknameInput}
                  onChange={(e) => setNicknameInput(e.target.value.slice(0, 8))}
                  maxLength={8}
                  placeholder="max 8"
                  autoFocus
                />
                <button type="submit" disabled={!nicknameInput.trim()}>
                  Start
                </button>
              </div>
              <p>{nicknameInput.length}/8</p>
            </form>
          )}
        </div>
      ) : isArtworkPage ? (
        <main className="detail-page" aria-label="Artwork details page">
          <section className="detail-page__intro">
            <button
              type="button"
              className="detail-page__back"
              onClick={closeAlbumDetail}
            >
              Back to Gallery
            </button>

            <div className="detail-page__kicker">A CREATIVE INFRASTRUCTURE</div>
            <h1>{activeAlbumDetail?.name || activeAlbum?.name || "Artwork"}</h1>
            <p className="detail-page__artist">
              {activeAlbumDetail?.artists?.[0]?.name ||
                activeAlbum?.artist ||
                "Unknown Artist"}
            </p>
            {!albumDetailLoading && activeAlbumDetail && (
              <p className="detail-page__summary">
                {formatReleaseDate(activeAlbumDetail.releaseDate)} ·{" "}
                {activeAlbumDetail.medium} · {activeAlbumDetail.museum}
              </p>
            )}
          </section>

          <section className="detail-page__spread">
            <div className="detail-page__image-panel">
              {activeAlbumDetail?.imageUrl || activeAlbum?.imageUrl ? (
                <img
                  src={activeAlbumDetail?.imageUrl || activeAlbum?.imageUrl}
                  alt={
                    activeAlbumDetail?.name || activeAlbum?.name || "Artwork"
                  }
                />
              ) : (
                <div className="detail-page__placeholder">Loading image...</div>
              )}
            </div>

            <div className="detail-page__text-panel">
              {activeAlbumDetail?.imageUrl || activeAlbum?.imageUrl ? (
                <div className="detail-page__detail-image" aria-hidden>
                  <img
                    src={activeAlbumDetail?.imageUrl || activeAlbum?.imageUrl}
                    alt=""
                  />
                </div>
              ) : null}

              {albumDetailLoading && (
                <p className="detail-page__loading">Loading details...</p>
              )}

              {!albumDetailLoading && activeAlbumDetail && (
                <>
                  <section className="detail-page__section">
                    <h2>Save</h2>
                    <div className="detail-page__save-actions">
                      <button
                        type="button"
                        className={`detail-page__save-btn${isFavorited ? " is-active" : ""}`}
                        onClick={toggleFavorite}
                      >
                        {isFavorited
                          ? "Saved to Favorites"
                          : "Save to Favorites"}
                      </button>

                      <div className="detail-page__collection-row">
                        <select
                          className="detail-page__collection-select"
                          value={selectedCollectionId}
                          onChange={(e) =>
                            setSelectedCollectionId(e.target.value)
                          }
                        >
                          <option value="">Choose collection</option>
                          {collections.map((collection) => (
                            <option key={collection.id} value={collection.id}>
                              {collection.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="detail-page__save-btn"
                          onClick={addToCollection}
                          disabled={!selectedCollectionId}
                        >
                          {inSelectedCollection ? "In Collection" : "Add"}
                        </button>
                      </div>

                      <div className="detail-page__collection-row">
                        <input
                          className="detail-page__collection-input"
                          type="text"
                          placeholder="New collection"
                          value={newCollectionName}
                          onChange={(e) => setNewCollectionName(e.target.value)}
                        />
                        <button
                          type="button"
                          className="detail-page__save-btn"
                          onClick={createCollection}
                          disabled={!newCollectionName.trim()}
                        >
                          Create
                        </button>
                      </div>
                    </div>
                  </section>

                  <section className="detail-page__section">
                    <h2>Movement / Type</h2>
                    <div className="detail-page__chips">
                      {activeAlbumDetail.genres.length ? (
                        activeAlbumDetail.genres.map((genre) => (
                          <span key={genre}>{genre}</span>
                        ))
                      ) : (
                        <span>Unlisted</span>
                      )}
                    </div>
                  </section>

                  <section className="detail-page__section">
                    <h2>Dimensions</h2>
                    <p>
                      {activeAlbumDetail.dimensions || "Unknown dimensions"}
                    </p>
                  </section>

                  <section className="detail-page__section">
                    <h2>Story Behind It</h2>
                    <p>{storyText}</p>
                  </section>

                  <section className="detail-page__section">
                    <h2>Color Combination</h2>
                    <div className="detail-page__palette">
                      {colorCombination.map((color) => (
                        <div
                          className="detail-page__swatch"
                          key={`${color.hex}-${color.label}`}
                        >
                          <span
                            className="detail-page__swatch-color"
                            style={{ backgroundColor: color.hex }}
                            aria-hidden
                          />
                          <span className="detail-page__swatch-label">
                            {color.label}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="detail-page__section">
                    <h2>History</h2>
                    <p>{activeAlbumDetail.history}</p>
                  </section>

                  <section className="detail-page__section">
                    <h2>Meaning</h2>
                    <p>{activeAlbumDetail.meaning}</p>
                  </section>

                  <section className="detail-page__section">
                    <h2>Similar Artworks</h2>
                    {similarArtworks.length ? (
                      <div className="detail-page__similar-grid">
                        {similarArtworks.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            className="detail-page__similar-item"
                            onClick={() => void onSelectAlbum(item)}
                          >
                            <img
                              src={item.imageUrl}
                              alt=""
                              loading="lazy"
                              decoding="async"
                            />
                            <span>{item.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="detail-page__muted">
                        No similar artworks found yet.
                      </p>
                    )}
                  </section>
                </>
              )}
            </div>
          </section>
        </main>
      ) : showLibrary ? (
        layoutMode === "drag" ? (
          <AlbumRibbon
            albums={visibleAlbums}
            onSelectAlbum={onSelectAlbum}
            gestureScroll={gestureEnabled ? gestureScroll : undefined}
            gestureSelectSeq={gestureEnabled ? gestureSelectSeq : undefined}
          />
        ) : (
          <main className="art-grid-wrap" aria-label="Artwork grid view">
            <section className="art-grid">
              {visibleAlbums.map((album) => (
                <button
                  key={album.id}
                  type="button"
                  className="art-grid__item"
                  onClick={() => void onSelectAlbum(album)}
                  aria-label={`${album.name} by ${album.artist}`}
                >
                  {album.imageUrl ? (
                    <img
                      src={album.imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="art-grid__fallback" aria-hidden />
                  )}
                  <span className="art-grid__meta">
                    <strong>{album.name}</strong>
                    <small>{album.artist}</small>
                  </span>
                </button>
              ))}
            </section>
          </main>
        )
      ) : showEmptyState ? (
        <div className="empty-search" role="status">
          <p>{emptyState.message}</p>
          {emptyState.action === "clear-search" && (
            <button type="button" onClick={() => setSearchQuery("")}>
              Clear Search
            </button>
          )}
          {emptyState.action === "show-all" && (
            <button type="button" onClick={() => setGalleryScope("all")}>
              Show All
            </button>
          )}
        </div>
      ) : (
        <div className="preconnect-poster" aria-label="Pre-connect poster">
          <div className="preconnect-poster__name">{nickname}</div>
        </div>
      )}

      <HandGestureController
        enabled={
          gestureEnabled && !isArtworkPage && connected && layoutMode === "drag"
        }
        onScroll={onGestureScroll}
        onSelect={onGestureSelect}
        onStateChange={onGestureStateChange}
      />
    </div>
  );
}
