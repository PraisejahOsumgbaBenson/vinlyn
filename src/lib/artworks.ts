const fallbackSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
  <rect width="800" height="800" fill="#f2f0ec"/>
  <text x="400" y="400" dominant-baseline="middle" text-anchor="middle" font-family="Georgia, serif" font-size="30" fill="#6a6864">Image unavailable</text>
</svg>`;

export const IMAGE_FALLBACK = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg)}`;

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
  date_start?: number;
  date_end?: number;
  style_title?: string;
  artwork_type_title?: string;
  classification_title?: string;
  subject_titles?: string[];
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
  categories?: { title: string }[];
};

type WikiResponse = {
  query?: {
    pages?: WikiPage[];
  };
};

// Cantaloupe rejects IIIF requests that upscale beyond the source image.
// 600 is the largest preset that fits nearly every artwork. If an image is
// still smaller, walk down the preset sizes before giving up.
const IIIF_SIZES = [600, 400, 200];
const DEFAULT_IIIF_SIZE = IIIF_SIZES[0];

export function nextImageSize(currentSrc: string): string | null {
  const match = currentSrc.match(/^(.*\/full\/)(\d+)(,\/0\/default\.jpg)$/);
  if (!match) return null;
  const index = IIIF_SIZES.indexOf(Number(match[2]));
  if (index === -1 || index === IIIF_SIZES.length - 1) return null;
  return `${match[1]}${IIIF_SIZES[index + 1]}${match[3]}`;
}

const ACCESS_KEY = "vinlyn_art_access";
const EXPIRES_KEY = "vinlyn_art_expires";

function isLocalHost(): boolean {
  if (typeof window === "undefined") return false;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

const useLocalProxy = isLocalHost();
const apiBase = useLocalProxy
  ? "/aic-api/api/v1"
  : "https://api.artic.edu/api/v1";
const iiifBase = useLocalProxy
  ? "/aic-iiif/iiif/2"
  : "https://www.artic.edu/iiif/2";
const detailCache = new Map<string, SpotifyAlbumDetail>();
const AIC_SAFE_LIMIT = 20;
const MAX_COLLECTION_RESULTS = 60;
const MAX_SEARCH_RESULTS = 80;
const WIKI_SEARCH_LIMIT = 24;
const WIKI_ID_PREFIX = "wiki:";

const ART_MOVEMENTS: SpotifyPlaylist[] = [
  { id: "impressionism", name: "Impressionism", imageUrl: "", tracksTotal: 0 },
  { id: "renaissance", name: "Renaissance", imageUrl: "", tracksTotal: 0 },
  { id: "baroque", name: "Baroque", imageUrl: "", tracksTotal: 0 },
];

const movementTotalCache = new Map<string, number>();

function imageUrlFromId(imageId?: string): string {
  if (!imageId) return "";
  return `${iiifBase}/${imageId}/full/${DEFAULT_IIIF_SIZE},/0/default.jpg`;
}

function parseArtist(art: AicArtwork): string {
  return art.artist_title || art.artist_display || "Unknown Artist";
}

function artworkToCover(art: AicArtwork): AlbumCover | null {
  if (!art.image_id || !isAllowedArtwork(art)) return null;
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

// Wikipedia search also returns actors, films and songs. Keep only pages that
// describe an artwork, an art movement or an art collection. Person role words
// in a category mean the page is a biography, even when another category
// mentions a painting technique.
const ART_PAGE_PATTERN =
  /\b(paintings?|drawings?|sculptures?|photographs?|prints?|frescoes?|mosaics?|ceramics?|pottery|textiles?|tapestries?|miniatures?|manuscripts?|engravings?|etchings?|lithographs?|woodcuts?|artworks?|works of art|portraits?|museums?|art galleries|architecture|cathedrals?|temples?|statues?|busts?|reliefs?|art movements?|visual arts?|installations?|collages?)\b/i;
const PERSON_CATEGORY_PATTERN =
  /\b(actresses?|actors?|films?|television|tv series|singers?|musicians?|music|musical groups?|bands?|living people|sports?|players?|politicians?|journalists?|models?|dancers?|painters?|printmakers?|engravers?|sculptors?|photographers?|architects?|illustrators?|designers?|writers?|authors?|poets?|composers?|rugby|football|cricket|novels?|songs?|albums?|newspapers?|episodes|comics?|video games?|software|companies|organizations|occupations?)\b/i;
const PERSON_DESCRIPTION_PATTERN = new RegExp(
  `${PERSON_CATEGORY_PATTERN.source}|\\bartists?\\b|\\bbiography\\b`,
  "i",
);

// The gallery is a historical art collection. Photographs, modern movements
// and works that depict nudity are outside that scope.
const HISTORICAL_CUTOFF_YEAR = 1900;
const BLOCKED_SUBJECT_TERMS = ["nudes", "naked", "bather", "bathing", "torso", "erotic"];
const MODERN_STYLE_PATTERN =
  /\b(pop art|modern|contemporary|abstract|surrealism|cubism|futurism|expressionism|bauhaus|art deco|minimalism|conceptual|performance art|digital)\b/i;
const PHOTOGRAPH_PATTERN =
  /\b(photograph|photography|photo|daguerreotype|gelatin silver|cyanotype)\b/i;
const SEXUAL_CONTENT_PATTERN =
  /\b(nude|nudes|nudity|naked|undressed|undressing|erotic|erotica|sexual|sex|bather|bathers|bathing|torso|odalisque|venus|aphrodite|bacchic|satyr|seduction|sensual)\b/i;
const BLOCKED_QUERY_PATTERN =
  /\b(nude|nudes|nudity|naked|undress|undressed|undressing|erotic|erotica|sex|sexual|porn|pornography|nsfw|explicit|penis|vagina|boobs|tits|fetish|orgy|lingerie|seductive|bather|bathers|bathing|torso|odalisque)\b/i;

export function isBlockedSearchQuery(query: string): boolean {
  return BLOCKED_QUERY_PATTERN.test(query.trim());
}

export function isAllowedArtwork(art: AicArtwork): boolean {
  const media = [art.artwork_type_title, art.classification_title, art.medium_display]
    .filter(Boolean)
    .join(" ");
  if (PHOTOGRAPH_PATTERN.test(media)) return false;

  const year = art.date_end ?? art.date_start;
  if (year !== undefined && year > HISTORICAL_CUTOFF_YEAR) return false;
  if (MODERN_STYLE_PATTERN.test(art.style_title || "")) return false;

  const description = [
    art.title,
    art.thumbnail?.alt_text,
    ...(art.subject_titles ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  return !SEXUAL_CONTENT_PATTERN.test(description);
}

function isArtWikiPage(page: WikiPage): boolean {
  const description = page.description || "";
  const categories = (page.categories || []).map((entry) => entry.title);
  const pageText = `${page.title} ${description} ${categories.join(" ")}`;
  const isArt =
    categories.some((category) => ART_PAGE_PATTERN.test(category)) ||
    ART_PAGE_PATTERN.test(description);
  const isPerson =
    categories.some((category) => PERSON_CATEGORY_PATTERN.test(category)) ||
    PERSON_DESCRIPTION_PATTERN.test(description);
  const isModern =
    MODERN_STYLE_PATTERN.test(pageText) || PHOTOGRAPH_PATTERN.test(pageText);
  return isArt && !isPerson && !isModern;
}

// User-entered queries must match artwork fields. The plain `q` parameter
// matches catalogue text and boosts anything, so a single word such as
// "monalisa" returns the whole collection instead of the Mona Lisa.
const SCOPED_SEARCH_FIELDS = [
  "title",
  "artist_title",
  "artist_display",
  "style_title",
];

function requestParam(key: string, value: string | number): string {
  return `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`;
}

// Apply the historical rules in the API query as well as in the mapper. That
// keeps a filtered search from walking every page of the collection before it
// finds enough allowed artworks.
export function historicalArtworkSearchParams(
  query: string,
  scoped: boolean,
): string {
  const parts: string[] = [];

  if (scoped) {
    for (const field of SCOPED_SEARCH_FIELDS) {
      parts.push(
        requestParam(
          `query[bool][should][][match_phrase][${field}]`,
          query,
        ),
      );
    }
    parts.push(requestParam("query[bool][minimum_should_match]", 1));
  } else {
    parts.push(requestParam("q", query));
  }

  parts.push(
    requestParam("query[bool][filter][][range][date_end][lte]", HISTORICAL_CUTOFF_YEAR),
  );
  for (const term of BLOCKED_SUBJECT_TERMS) {
    parts.push(requestParam("query[bool][must_not][][match][subject_titles]", term));
  }
  parts.push(requestParam("query[bool][must_not][][match][artwork_type_title]", "photograph"));
  parts.push(requestParam("query[bool][must_not][][match][classification_title]", "photograph"));

  return parts.join("&");
}

function compactArtTitle(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = (await res.text()).slice(0, 120);
    throw new Error(`Art API: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function fetchSearchTotal(query: string): Promise<number> {
  const cached = movementTotalCache.get(query);
  if (typeof cached === "number") return cached;
  const data = await fetchJson<AicResponse>(
    `${apiBase}/artworks/search?${historicalArtworkSearchParams(query, false)}&limit=1&fields=id`,
  );
  const total = Math.max(0, Number(data.pagination?.total ?? 0));
  movementTotalCache.set(query, total);
  return total;
}

async function fetchAllSearchCovers(
  query: string,
  maxResults = MAX_SEARCH_RESULTS,
  scoped = false,
): Promise<AlbumCover[]> {
  const out: AlbumCover[] = [];
  let page = 1;
  let totalPages = 1;
  const maxPages = Math.ceil(maxResults / AIC_SAFE_LIMIT);
  const searchParams = historicalArtworkSearchParams(query, scoped);

  // Filtering happens while mapping covers. Bounding by page count keeps a
  // heavily filtered query from walking every page of the collection.
  while (page <= totalPages && page <= maxPages) {
    const data = await fetchJson<AicResponse>(
      `${apiBase}/artworks/search?${searchParams}&limit=${AIC_SAFE_LIMIT}&page=${page}&fields=${encodeURIComponent(fieldsList())}`,
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
  const maxPages = Math.ceil(maxResults / AIC_SAFE_LIMIT);

  while (page <= totalPages && page <= maxPages) {
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
    `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit}&prop=pageimages|description|categories&cllimit=max&piprop=thumbnail&pithumbsize=843&format=json&formatversion=2&origin=*`,
  );

  const pages = data.query?.pages ?? [];
  return pages
    .filter(
      (page) =>
        Boolean(page.pageid && page.thumbnail?.source) && isArtWikiPage(page),
    )
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
  scoped = false,
): Promise<AlbumCover[]> {
  const aicLimit = Math.max(1, maxResults - WIKI_SEARCH_LIMIT);
  const [aic, wiki] = await Promise.all([
    fetchAllSearchCovers(query, aicLimit, scoped),
    fetchWikiSearchCovers(query, WIKI_SEARCH_LIMIT).catch(() => []),
  ]);

  // Wikipedia resolves concatenated titles such as "monalisa" to "Mona Lisa".
  // Reuse that title when the scoped artwork search found nothing, so the
  // museum versions of the work appear alongside the reference entry.
  let artworkResults = aic;
  if (scoped && artworkResults.length === 0 && wiki.length > 0) {
    const correctedTitle = wiki[0].name;
    const correctedResults = await fetchAllSearchCovers(
      correctedTitle,
      aicLimit,
      true,
    ).catch(() => []);
    artworkResults = correctedResults.filter(
      (cover) => compactArtTitle(cover.name) === compactArtTitle(correctedTitle),
    );
  }

  return dedupeCovers([...artworkResults, ...wiki]).slice(0, maxResults);
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
    "date_start",
    "date_end",
    "style_title",
    "artwork_type_title",
    "classification_title",
    "subject_titles",
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
): Promise<AlbumCover[]> {
  void _token;
  const term = query.trim();
  if (!term) return [];

  return fetchCombinedSearchCovers(term, MAX_SEARCH_RESULTS, true);
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
