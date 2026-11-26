import { describe, expect, it } from "bun:test";
import {
  historicalArtworkSearchParams,
  isAllowedArtwork,
  isBlockedSearchQuery,
  isCacheFresh,
  isArtWikiPage,
  mergeCoverBatches,
  type AlbumCover,
} from "./artworks";

describe("historical artwork filtering", () => {
  it("rejects works made after 1900", () => {
    expect(
      isAllowedArtwork({
        id: 1,
        title: "A Modern Poster",
        date_start: 1960,
        date_end: 1960,
      }),
    ).toBe(false);
  });

  it("rejects photographs", () => {
    expect(
      isAllowedArtwork({
        id: 2,
        title: "A Studio Portrait",
        artwork_type_title: "Photograph",
        date_end: 1880,
      }),
    ).toBe(false);
  });

  it("rejects works tagged with nudity", () => {
    expect(
      isAllowedArtwork({
        id: 3,
        title: "Study",
        subject_titles: ["women", "nudes"],
        date_end: 1880,
      }),
    ).toBe(false);
  });

  it("rejects body-focused titles", () => {
    expect(
      isAllowedArtwork({
        id: 4,
        title: "Venus Rising",
        date_end: 1880,
      }),
    ).toBe(false);
  });

  it("keeps historical paintings", () => {
    expect(
      isAllowedArtwork({
        id: 5,
        title: "The Adoration of the Magi",
        artwork_type_title: "Painting",
        date_start: 1490,
        date_end: 1500,
        subject_titles: ["Christian subjects"],
      }),
    ).toBe(true);
  });
});

describe("blocked searches", () => {
  it("blocks sexual body queries", () => {
    expect(isBlockedSearchQuery("bathing women")).toBe(true);
    expect(isBlockedSearchQuery("nude study")).toBe(true);
  });

  it("allows art queries", () => {
    expect(isBlockedSearchQuery("monalisa")).toBe(false);
    expect(isBlockedSearchQuery("impressionism")).toBe(false);
  });
});

describe("Wikipedia art page filtering", () => {
  const starryNight = {
    pageid: 186987,
    title: "The Starry Night",
    description: "1889 painting by Vincent van Gogh",
    thumbnail: { source: "https://example.com/starry-night.jpg" },
    categories: [
      { title: "Category:1889 paintings" },
      { title: "Category:Paintings by Vincent van Gogh" },
      {
        title:
          "Category:Paintings in the Museum of Modern Art (New York City)",
      },
    ],
  };

  it("keeps a historical painting even when a museum category says modern", () => {
    expect(isArtWikiPage(starryNight)).toBe(true);
  });

  it("rejects a modern style in the title or description", () => {
    expect(
      isArtWikiPage({
        ...starryNight,
        title: "Cubist Study",
        description: "1889 cubism painting by an artist",
      }),
    ).toBe(false);
  });

  it("rejects biographies that appear in artist searches", () => {
    expect(
      isArtWikiPage({
        ...starryNight,
        title: "Theo van Gogh (art dealer)",
        description: "Dutch art dealer (1857-1891)",
      }),
    ).toBe(false);
  });

  it("rejects photographs and works made after 1900", () => {
    expect(
      isArtWikiPage({
        ...starryNight,
        title: "A Studio Portrait",
        description: "1880 photograph by an artist",
      }),
    ).toBe(false);
    expect(
      isArtWikiPage({
        ...starryNight,
        title: "A Later Painting",
        description: "1910 painting by an artist",
      }),
    ).toBe(false);
  });
});

describe("historicalArtworkSearchParams", () => {
  it("limits results to works ending by 1900", () => {
    const params = historicalArtworkSearchParams("painting", false);
    expect(params).toContain("query%5Bbool%5D%5Bfilter%5D%5B%5D%5Brange%5D%5Bdate_end%5D%5Blte%5D=1900");
  });

  it("excludes photographs and nudity at the API boundary", () => {
    const params = historicalArtworkSearchParams("painting", false);
    expect(params).toContain("subject_titles%5D=nudes");
    expect(params).toContain("artwork_type_title%5D=photograph");
  });
});

describe("loading helpers", () => {
  it("merges successful page batches and skips failed pages", () => {
    const first: AlbumCover = {
      id: "1",
      name: "First",
      artist: "Artist",
      imageUrl: "/first.jpg",
    };
    const second: AlbumCover = {
      id: "2",
      name: "Second",
      artist: "Artist",
      imageUrl: "/second.jpg",
    };
    const batches: PromiseSettledResult<AlbumCover[]>[] = [
      { status: "fulfilled", value: [first, { ...first }] },
      { status: "rejected", reason: new Error("Slow page") },
      { status: "fulfilled", value: [second] },
    ];

    expect(mergeCoverBatches(batches, 10)).toEqual([first, second]);
  });

  it("treats a cache entry as fresh only inside its lifetime", () => {
    const now = 1_000_000;

    expect(isCacheFresh(now - 1_000, now, 5_000)).toBe(true);
    expect(isCacheFresh(now - 6_000, now, 5_000)).toBe(false);
  });
});
