/** A CSS colour as one packed pixel, in the byte order `ImageData` takes. */
export function packed(color: string): number {
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return 0;
  probe.fillStyle = color;
  probe.fillRect(0, 0, 1, 1);
  return new Uint32Array(probe.getImageData(0, 0, 1, 1).data.buffer)[0];
}

/**
 * Paints frames of cells onto `canvas`: each frame value picks a packed
 * colour from `colors` (0 stays clear), one pixel a cell on a cell-sized
 * canvas, then scaled up `unit` times in one `drawImage` with smoothing
 * off, so every cell is a crisp square of whole device pixels.
 */
export function cellPainter(canvas: HTMLCanvasElement, colors: readonly number[]) {
  const ctx = canvas.getContext("2d");
  const off = document.createElement("canvas");
  const offCtx = off.getContext("2d");
  let image: ImageData | null = null;
  let unit = 1;

  return {
    resize(cols: number, rows: number, cellUnit: number) {
      unit = cellUnit;
      off.width = cols;
      off.height = rows;
      image = offCtx?.createImageData(cols, rows) ?? null;
    },
    paint(frame: Uint8Array) {
      if (!ctx || !offCtx || !image) return;
      const px = new Uint32Array(image.data.buffer);
      for (let i = 0; i < frame.length; i++) px[i] = frame[i] ? colors[frame[i]] : 0;
      offCtx.putImageData(image, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, 0, 0, off.width * unit, off.height * unit);
    },
  };
}
