const TRANSLITERATIONS: Record<string, string> = {
  "\u00a0": " ",
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2015": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": "\"",
  "\u201d": "\"",
  "\u2022": "*",
  "\u2026": "...",
  "\u2190": "<-",
  "\u2191": "^",
  "\u2192": "->",
  "\u2193": "v",
  "\u2194": "<->",
  "\u2212": "-",
};

const TRANSLITERATION_PATTERN = new RegExp(`[${Object.keys(TRANSLITERATIONS).join("")}]`, "g");
const NON_DOS_BYTES = /[^\x09\x0a\x20-\x7e]/g;

export function toDosAscii(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(TRANSLITERATION_PATTERN, (character) => TRANSLITERATIONS[character] ?? character)
    .replace(NON_DOS_BYTES, "");
}

const MAX_PATH_BYTES = 67;

export function encodeDosPath(path: string): Buffer {
  const encoded = Buffer.from(toDosAscii(path), "ascii");
  if (encoded.length < 1 || encoded.length > MAX_PATH_BYTES) {
    throw new RangeError(`DOS path must contain 1 to ${MAX_PATH_BYTES} bytes`);
  }
  return encoded;
}