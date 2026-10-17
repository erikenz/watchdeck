/**
 * A zip reader, small enough to own.
 *
 * SponsorBlock publishes itself as a zip and the app needs exactly that one archive at runtime.
 * The obvious dependency for it (fflate) declares `require` at module scope in its ESM entry, which
 * rolldown then doubles with its own shim - `Identifier 'require' has already been declared` takes
 * the whole main process down. Reading the central directory ourselves and inflating the entries
 * with `node:zlib` is the smaller answer and one fewer thing in the main bundle.
 */
import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06_05_4b_50;
const CENTRAL_DIRECTORY_ENTRY = 0x02_01_4b_50;

/** The zip record's own header sizes, which never change between versions. */
const EOCD_SIZE = 22;
const CENTRAL_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;

/** Deflate is method 8; method 0 is stored as-is. */
const DEFLATE = 8;
const STORED = 0;

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const readU32 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);

const readU16 = (bytes: Uint8Array, offset: number) =>
  new DataView(bytes.buffer, bytes.byteOffset + offset, 2).getUint16(0, true);

const findEndOfCentralDirectory = (bytes: Uint8Array): number => {
  // The record sits at the end, after a comment of up to 64 KiB
  const earliest = Math.max(0, bytes.length - EOCD_SIZE - 0xff_ff);

  for (let offset = bytes.length - EOCD_SIZE; offset >= earliest; offset -= 1) {
    if (readU32(bytes, offset) === END_OF_CENTRAL_DIRECTORY) {
      return offset;
    }
  }

  return -1;
};

/**
 * Reads every file in the archive. Directory entries are skipped, and so is anything that would
 * land outside the archive's own paths by name (the caller joins names under its own root and
 * checks that again).
 */
export const readZip = (bytes: Uint8Array): ZipEntry[] => {
  const end = findEndOfCentralDirectory(bytes);

  if (end === -1) {
    throw new Error("not a zip archive: no end of central directory");
  }

  const entryCount = readU16(bytes, end + 10);
  let cursor = readU32(bytes, end + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (readU32(bytes, cursor) !== CENTRAL_DIRECTORY_ENTRY) {
      throw new Error(`broken zip archive: bad entry at ${cursor}`);
    }

    const method = readU16(bytes, cursor + 10);
    const compressedSize = readU32(bytes, cursor + 20);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const localOffset = readU32(bytes, cursor + 42);
    const name = new TextDecoder().decode(
      bytes.subarray(
        cursor + CENTRAL_HEADER_SIZE,
        cursor + CENTRAL_HEADER_SIZE + nameLength
      )
    );

    cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) {
      continue;
    }

    // The local header repeats the name and extra fields; the data starts after them
    const localNameLength = readU16(bytes, localOffset + 26);
    const localExtraLength = readU16(bytes, localOffset + 28);
    const dataStart =
      localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
    const payload = bytes.subarray(dataStart, dataStart + compressedSize);

    if (method === STORED) {
      entries.push({ data: payload, name });
    } else if (method === DEFLATE) {
      entries.push({ data: inflateRawSync(payload), name });
    }
  }

  return entries;
};
