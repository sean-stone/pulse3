declare module "gif.js" {
  type GifFrame = CanvasImageSource | ImageData;
  type GifOptions = {
    workers?: number;
    workerScript?: string;
    quality?: number;
    width?: number;
    height?: number;
    repeat?: number;
    background?: string;
  };

  type GifAddFrameOptions = {
    delay?: number;
    copy?: boolean;
  };

  export default class GIF {
    constructor(options?: GifOptions);
    addFrame(image: GifFrame, options?: GifAddFrameOptions): void;
    on(event: "finished", handler: (blob: Blob) => void): void;
    on(event: "abort", handler: () => void): void;
    on(event: "progress", handler: (progress: number) => void): void;
    render(): void;
    abort(): void;
  }
}

declare module "gif.js/dist/gif.worker.js?url" {
  const workerUrl: string;
  export default workerUrl;
}
