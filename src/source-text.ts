export interface FontDescriptor {
  fontName: {
    family: string;
    style: string;
  };
}

export interface SourceTextMetrics {
  characters: string;
  height: number;
  lineHeight?: number;
}

function normalizedFontName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedFontFamily(value: string): string {
  const normalized = normalizedFontName(value).replace(/variable$/, "");
  if (
    normalized === "uisansserif" ||
    normalized === "systemui" ||
    normalized === "sansserif"
  ) {
    return "inter";
  }
  return normalized;
}

export function selectSourceFontName(
  sourceFamily: string,
  sourceStyle: string,
  fonts: readonly FontDescriptor[],
): FontDescriptor["fontName"] | undefined {
  const family = normalizedFontFamily(sourceFamily);
  const style = normalizedFontName(sourceStyle);
  const familyFonts = fonts.filter(
    (font) => normalizedFontFamily(font.fontName.family) === family,
  );
  return (
    familyFonts.find(
      (font) => normalizedFontName(font.fontName.style) === style,
    )?.fontName ??
    familyFonts.find(
      (font) => normalizedFontName(font.fontName.style) === "regular",
    )?.fontName
  );
}

export function isSingleLineSourceText(
  source: SourceTextMetrics,
): boolean {
  if (source.characters.includes("\n")) return false;
  if (!source.lineHeight || source.lineHeight <= 0) return true;
  return source.height <= source.lineHeight * 1.5;
}
