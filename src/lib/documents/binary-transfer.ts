export function normalizeToArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) {
    return data.slice(0);
  }

  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const copy = view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
    return copy as ArrayBuffer;
  }

  if (data instanceof Blob) {
    throw new Error('Blob must be converted to ArrayBuffer before OCR');
  }

  if (Array.isArray(data)) {
    return Uint8Array.from(data as number[]).buffer;
  }

  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (record.type === 'Buffer' && Array.isArray(record.data)) {
      return Uint8Array.from(record.data as number[]).buffer;
    }

    const values = Object.values(record);
    if (values.length > 0 && values.every((value) => typeof value === 'number')) {
      return Uint8Array.from(values as number[]).buffer;
    }
  }

  throw new Error('Invalid image data for OCR');
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes.buffer;
}
