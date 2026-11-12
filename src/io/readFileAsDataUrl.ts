/**
 * Read a file/blob as a `data:` URL, rejecting if the read fails or is aborted.
 * `FileReader` reports a failed read (truncated or permission-denied file, revoked
 * clipboard blob) only through `onerror`/`onabort`; a bare `onload` wrapper never
 * settles then, and the caller hangs. Fully local — nothing leaves the device.
 */
export function readFileAsDataUrl(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the file.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onabort = () => reject(new Error('Reading the file was cancelled.'));
    try {
      reader.readAsDataURL(blob);
    } catch (err) {
      reject(err instanceof Error ? err : new Error('Could not read the file.'));
    }
  });
}
