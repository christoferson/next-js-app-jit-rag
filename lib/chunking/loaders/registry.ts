// Loader registry — add a loader (e.g. pptx) = one class + one entry here.
import type { Loader } from "./types";
import { TextLoader } from "./text-loader";
import { PdfLoader } from "./pdf-loader";
import { UnsupportedFileType } from "../../errors/errors";

export const LOADERS: Loader[] = [new TextLoader(), new PdfLoader()];

export function getLoader(fileType: string): Loader {
  const loader = LOADERS.find((l) => l.fileTypes.includes(fileType));
  if (!loader) throw new UnsupportedFileType(fileType);
  return loader;
}

export const SUPPORTED_FILE_TYPES = LOADERS.flatMap((l) => l.fileTypes);
