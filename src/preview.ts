import fs from "node:fs";
import path from "node:path";
import { BridgeError, ID, type Response } from "./bridge-client.js";

export const PREVIEW_MAX_BYTES = 16 * 1024 * 1024;
// Never trust an AE response as an arbitrary file-read path.
export function previewImage(directory: string, response: Response) {
  const id = response.requestId;
  if (!ID.test(id) || response.data?.artifact !== `${id}.png`)
    throw new BridgeError(
      "INVALID_PREVIEW",
      "Preview identity does not match request.",
      id
    );
  const folder = path.join(directory, "previews");
  const file = path.join(folder, `${id}.png`);
  if (
    fs.lstatSync(folder).isSymbolicLink() ||
    fs.lstatSync(file).isSymbolicLink() ||
    fs.realpathSync(folder) !== folder ||
    fs.realpathSync(file) !== file
  )
    throw new BridgeError(
      "INVALID_PREVIEW",
      "Preview must remain in the bridge preview directory.",
      id
    );
  const fd = fs.openSync(file, "r");
  let bytes: Buffer;
  try {
    const size = fs.fstatSync(fd).size;
    if (size > PREVIEW_MAX_BYTES)
      throw new BridgeError("INVALID_PREVIEW", "Preview exceeds 16 MiB.", id);
    if (size < 33)
      throw new BridgeError(
        "PREVIEW_INCOMPLETE",
        "Preview is empty or truncated.",
        id
      );
    bytes = Buffer.alloc(size);
    let read = 0;
    while (read < size) {
      const count = fs.readSync(fd, bytes, read, size - read, read);
      if (!count)
        throw new BridgeError(
          "PREVIEW_INCOMPLETE",
          "Preview changed while reading.",
          id
        );
      read += count;
    }
  } finally {
    fs.closeSync(fd);
  }
  if (
    !bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(16) !== response.data.width ||
    bytes.readUInt32BE(20) !== response.data.height ||
    response.data.width * response.data.height > 8300000
  )
    throw new BridgeError(
      "INVALID_PREVIEW",
      "PNG dimensions/header do not match the capture result.",
      id
    );
  let offset = 8,
    complete = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (offset + 12 + length > bytes.length) break;
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    offset += 12 + length;
    if (type === "IEND") {
      complete = length === 0 && offset === bytes.length;
      break;
    }
  }
  if (!complete)
    throw new BridgeError(
      "PREVIEW_INCOMPLETE",
      "PNG is still being written (missing complete IEND).",
      id
    );
  return {
    type: "image" as const,
    mimeType: "image/png",
    data: bytes.toString("base64")
  };
}

export async function waitForPreview(
  directory: string,
  response: Response,
  timeoutMs = 5000
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return previewImage(directory, response);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        !["ENOENT", "PREVIEW_INCOMPLETE", "EBUSY", "EPERM"].includes(
          code || ""
        ) ||
        Date.now() >= deadline
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export function prunePreviews(directory: string, now = Date.now()) {
  const folder = path.join(directory, "previews");
  if (!fs.existsSync(folder) || fs.lstatSync(folder).isSymbolicLink()) return;
  for (const name of fs.readdirSync(folder)) {
    if (!/^[a-f0-9-]{36}\.png$/.test(name)) continue;
    const file = path.join(folder, name),
      stat = fs.lstatSync(file);
    if (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      now - stat.mtimeMs > 24 * 60 * 60 * 1000
    )
      fs.unlinkSync(file);
  }
}
