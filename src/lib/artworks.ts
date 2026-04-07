export type AlbumCover = {
  id: string;
  name: string;
  artist: string;
  imageUrl: string;
};

export type LibrarySource = "saved-albums" | "liked-songs" | "playlist";

export type SpotifyPlaylist = {
  id: string;
  name: string;
  imageUrl: string;
  tracksTotal: number;
};

export type SpotifyArtistRef = {
  id: string;
  name: string;
  spotifyUrl: string;
};

export type SpotifyAlbumDetail = {
  id: string;
  name: string;
  imageUrl: string;
  releaseDate: string;
  genres: string[];
  artists: SpotifyArtistRef[];
  medium: string;
  dimensions: string;
  museum: string;
  meaning: string;
  history: string;
};

type AicArtwork = {
  id: number;
  title: string;
  artist_display?: string;
  artist_title?: string;
  artist_id?: number;
  image_id?: string;
  date_display?: string;
  style_title?: string;
  artwork_type_title?: string;
  medium_display?: string;
  dimensions?: string;
  place_of_origin?: string;
  thumbnail?: { alt_text?: string };
  provenance_text?: string;
  inscriptions?: string;
};

type AicResponse = {
  data: AicArtwork[];
  pagination?: {
    total?: number;
    total_pages?: number;
    current_page?: number;
    next_url?: string | null;
  };
};

type AicDetailResponse = {
  data: AicArtwork;
};

type WikiPage = {
  pageid: number;
  title: string;
  fullurl?: string;
  extract?: string;
  description?: string;
  thumbnail?: { source?: string };
};

type WikiResponse = {
  query?: {
    pages?: WikiPage[];
  };
};

const ACCESS_KEY = "vinlyn_art_access";
const EXPIRES_KEY = "vinlyn_art_expires";
const apiBase = "https://api.artic.edu/api/v1";
const detailCache = new Map<string, SpotifyAlbumDetail>();
const AIC_SAFE_LIMIT = 20;
const MAX_COLLECTION_RESULTS = 240;
const MAX_SEARCH_RESULTS = 240;
const WIKI_SEARCH_LIMIT = 48;
const WIKI_ID_PREFIX = "wiki:";

const ART_MOVEMENTS: SpotifyPlaylist[] = [
  { id: "impressionism", name: "Impressionism", imageUrl: "", tracksTotal: 0 },
  { id: "renaissance", name: "Renaissance", imageUrl: "", tracksTotal: 0 },
  { id: "baroque", name: "Baroque", imageUrl: "", tracksTotal: 0 },
  { id: "surrealism", name: "Surrealism", imageUrl: "", tracksTotal: 0 },
  { id: "modern", name: "Modern Art", imageUrl: "", tracksTotal: 0 },
];

const movementTotalCache = new Map<string, number>();

function imageUrlFromId(imageId?: string): string {
  if (!imageId) return "";
  return `https://www.artic.edu/iiif/2/${imageId}/full/843,/0/default.jpg`;
}

function parseArtist(art: AicArtwork): string {
  return art.artist_title || art.artist_display || "Unknown Artist";
}

function artworkToCover(art: AicArtwork): AlbumCover | null {
  if (!art.image_id) return null;
  return {
    id: String(art.id),
    name: art.title || "Untitled",
    artist: parseArtist(art),
    imageUrl: imageUrlFromId(art.image_id),
  };
}

function dedupeCovers(list: AlbumCover[]): AlbumCover[] {
  const seen = new Set<string>();
  const out: AlbumCover[] = [];
  for (const cover of list) {
    if (!cover.id || seen.has(cover.id)) continue;
    seen.add(cover.id);
    out.push(cover);
  }
  return out;
}

function wikiIdFromPageId(pageId: number): string {
  return `${WIKI_ID_PREFIX}${pageId}`;
}

function pageIdFromWikiId(id: string): number | null {
  if (!id.startsWith(WIKI_ID_PREFIX)) return null;
  const raw = id.slice(WIKI_ID_PREFIX.length);
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function firstSentence(text: string): string {
  const cleaned = text.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  const match = cleaned.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] || cleaned).trim();
}

function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coverMatchesStrictQuery(cover: AlbumCover, query: string): boolean {
  const terms = normalizeSearchText(query).split(" ").filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalizeSearchText(`${cover.name} ${cover.artist}`);
  return terms.every((term) => haystack.includes(term));
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Art API: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function fetchSearchTotal(query: string): Promise<number> {
  const cached = movementTotalCache.get(query);
  if (typeof cached === "number") return cached;
  const data = await fetchJson<AicResponse>(
    `${apiBase}/artworks/search?q=${encodeURIComponent(query)}&limit=1&fields=id`,
  );
  const total = Math.max(0, Number(data.pagination?.total ?? 0));
  movementTotalCache.set(query, total);
  return total;
}

async function fetchAllSearchCovers(
  query: string,
  maxResults = MAX_SEARCH_RESULTS,
): Promise<AlbumCover[]> {
  const out: AlbumCover[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && out.length < maxResults) {
    const data = await fetchJson<AicResponse>(
      `${apiBase}/artworks/search?q=${encodeURIComponent(query)}&limit=${AIC_SAFE_LIMIT}&page=${page}&fields=${encodeURIComponent(fieldsList())}`,
    );
    const batch = (data.data ?? [])
      .map(artworkToCover)
      .filter((x): x is AlbumCover => Boolean(x));
    out.push(...batch);

    totalPages = Math.max(1, Number(data.pagination?.total_pages ?? page));
    page += 1;
  }

  return dedupeCovers(out).slice(0, maxResults);
}

async function fetchAllFeaturedCovers(
  maxResults = MAX_COLLECTION_RESULTS,
): Promise<AlbumCover[]> {
  const out: AlbumCover[] = [];
  let page = 1;
  let totalPages = 1;

  while (page <= totalPages && out.length < maxResults) {
    const data = await fetchJson<AicResponse>(
      `${apiBase}/artworks?limit=${AIC_SAFE_LIMIT}&page=${page}&fields=${encodeURIComponent(fieldsList())}`,
    );
    const batch = (data.data ?? [])
      .map(artworkToCover)
      .filter((x): x is AlbumCover => Boolean(x));
    out.push(...batch);

    totalPages = Math.max(1, Number(data.pagination?.total_pages ?? page));
    page += 1;
  }

  return dedupeCovers(out).slice(0, maxResults);
}

async function fetchWikiSearchCovers(
  query: string,
  maxResults = WIKI_SEARCH_LIMIT,
): Promise<AlbumCover[]> {
  const limit = Math.max(1, Math.min(maxResults, WIKI_SEARCH_LIMIT));
  const data = await fetchJson<WikiResponse>(
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit}&prop=pageimages|description&piprop=thumbnail&pithumbsize=843&format=json&formatversion=2&origin=*`,
  );

  const pages = data.query?.pages ?? [];
  return pages
    .filter((page) => Boolean(page.pageid && page.thumbnail?.source))
    .map((page) => ({
      id: wikiIdFromPageId(page.pageid),
      name: page.title || "Untitled",
      artist: page.description || "Wikipedia",
      imageUrl: page.thumbnail?.source || "",
    }));
}

async function fetchCombinedSearchCovers(
  query: string,
  maxResults = MAX_SEARCH_RESULTS,
): Promise<AlbumCover[]> {
  const [aic, wiki] = await Promise.all([
    fetchAllSearchCovers(query, Math.max(1, maxResults - WIKI_SEARCH_LIMIT)),
    fetchWikiSearchCovers(query, WIKI_SEARCH_LIMIT).catch(() => []),
  ]);
  return dedupeCovers([...aic, ...wiki]).slice(0, maxResults);
}

async function fetchWikiDetail(pageId: number): Promise<SpotifyAlbumDetail> {
  const data = await fetchJson<WikiResponse>(
    `https://en.wikipedia.org/w/api.php?action=query&pageids=${pageId}&prop=extracts|description|info|pageimages&inprop=url&explaintext=1&exsectionformat=plain&exintro=1&piprop=thumbnail&pithumbsize=1200&format=json&formatversion=2&origin=*`,
  );
  const page = data.query?.pages?.[0];
  if (!page?.pageid) {
    throw new Error("Wikipedia: artwork not found");
  }

  const description = page.description?.trim() || "Wikipedia entry";
  const extract = page.extract?.trim() || "No summary available.";
  const releaseYear = extract.match(/\b(1[0-9]{3}|20[0-9]{2})\b/)?.[1];
  const artistMatch = description.match(/\bby\s+([^,.;]+)/i);
  const artistName = artistMatch?.[1]?.trim() || description;

  const detail: SpotifyAlbumDetail = {
    id: wikiIdFromPageId(page.pageid),
    name: page.title || "Untitled",
    imageUrl: page.thumbnail?.source || "",
    releaseDate: releaseYear || "Unknown date",
    genres: [description],
    artists: [
      {
        id: String(page.pageid),
        name: artistName,
        spotifyUrl: page.fullurl || "https://en.wikipedia.org/",
      },
    ],
    medium: "Reference artwork",
    dimensions: "Unknown dimensions",
    museum: "Wikipedia / Open encyclopedic source",
    meaning: firstSentence(extract) || description,
    history: extract,
  };

  return detail;
}

function fieldsList(): string {
  return [
    "id",
    "title",
    "artist_display",
    "artist_title",
    "artist_id",
    "image_id",
    "date_display",
    "style_title",
    "artwork_type_title",
    "medium_display",
    "dimensions",
    "place_of_origin",
    "thumbnail",
    "provenance_text",
    "inscriptions",
  ].join(",");
}

export function redirectUri(): string {
  return `${window.location.origin}/`;
}

export function isSpotifyConfigured(): boolean {
  return true;
}

export async function beginSpotifyLogin(): Promise<void> {
  localStorage.setItem(ACCESS_KEY, "aic-public");
  localStorage.setItem(
    EXPIRES_KEY,
    String(Date.now() + 1000 * 60 * 60 * 24 * 365),
  );
}

export function clearOAuthParamsFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.size) return;
  url.search = "";
  window.history.replaceState({}, "", url.toString());
}

export async function consumeOAuthCallbackIfPresent(): Promise<void> {
  clearOAuthParamsFromUrl();
}

export async function getValidAccessToken(): Promise<string | null> {
  const token = localStorage.getItem(ACCESS_KEY);
  const exp = Number(localStorage.getItem(EXPIRES_KEY) || "0");
  if (token && Date.now() < exp) return token;
  await beginSpotifyLogin();
  return localStorage.getItem(ACCESS_KEY);
}

export function logoutSpotify(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(EXPIRES_KEY);
}

export async function fetchSavedAlbumCovers(
  _token: string,
): Promise<AlbumCover[]> {
  void _token;
  return fetchAllFeaturedCovers();
}

export async function fetchLikedTrackAlbumCovers(
  _token: string,
): Promise<AlbumCover[]> {
  void _token;
  return fetchCombinedSearchCovers("painting");
}

export async function fetchUserPlaylists(
  _token: string,
): Promise<SpotifyPlaylist[]> {
  void _token;
  const totals = await Promise.all(
    ART_MOVEMENTS.map(async (movement) => {
      try {
        return await fetchSearchTotal(movement.id);
      } catch {
        return movement.tracksTotal;
      }
    }),
  );

  return ART_MOVEMENTS.map((movement, i) => ({
    ...movement,
    tracksTotal: totals[i] ?? movement.tracksTotal,
  }));
}

export async function fetchPlaylistAlbumCovers(
  _token: string,
  playlistId: string,
): Promise<AlbumCover[]> {
  void _token;
  const query = playlistId || "painting";
  return fetchCombinedSearchCovers(query);
}

export async function searchArtworkCovers(
  _token: string,
  query: string,
  strictMatch = false,
): Promise<AlbumCover[]> {
  void _token;
  const term = query.trim();
  if (!term) return [];

  const results = await fetchCombinedSearchCovers(term);
  if (!strictMatch) return results;
  return results.filter((cover) => coverMatchesStrictQuery(cover, term));
}

export async function fetchAlbumDetail(
  _token: string,
  albumId: string,
): Promise<SpotifyAlbumDetail> {
  void _token;
  const cached = detailCache.get(albumId);
  if (cached) return cached;

  const wikiPageId = pageIdFromWikiId(albumId);
  if (wikiPageId !== null) {
    const wikiDetail = await fetchWikiDetail(wikiPageId);
    detailCache.set(albumId, wikiDetail);
    return wikiDetail;
  }

  const data = await fetchJson<AicDetailResponse>(
    `${apiBase}/artworks/${encodeURIComponent(albumId)}?fields=${encodeURIComponent(fieldsList())}`,
  );
  const art = data.data;
  if (!art?.id) {
    throw new Error("Art API: artwork not found");
  }

  const artistName = parseArtist(art);
  const artistLink = art.artist_id
    ? `https://www.artic.edu/artists/${art.artist_id}`
    : "https://www.artic.edu/";

  const genreParts = [art.style_title, art.artwork_type_title].filter(
    (x): x is string => Boolean(x && x.trim()),
  );

  const historyText =
    art.provenance_text?.trim() ||
    `This artwork is part of the Art Institute of Chicago collection.`;
  const meaningText =
    art.inscriptions?.trim() ||
    art.thumbnail?.alt_text?.trim() ||
    `Interpretation varies by viewer, context, and period.`;

  const detail: SpotifyAlbumDetail = {
    id: String(art.id),
    name: art.title || "Untitled",
    imageUrl: imageUrlFromId(art.image_id),
    releaseDate: art.date_display || "Unknown date",
    genres: genreParts,
    artists: [
      {
        id: String(art.artist_id ?? art.id),
        name: artistName,
        spotifyUrl: artistLink,
      },
    ],
    medium: art.medium_display || "Unknown medium",
    dimensions: art.dimensions || "Unknown dimensions",
    museum: "Art Institute of Chicago",
    meaning: meaningText,
    history: historyText,
  };

  detailCache.set(albumId, detail);
  return detail;
}

export function mockAlbums(count = 48): AlbumCover[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `demo-${i}`,
    name: `Demo artwork ${i + 1}`,
    artist: "Unknown Artist",
    imageUrl: `https://picsum.photos/seed/art${i}/600/600`,
  }));
}
