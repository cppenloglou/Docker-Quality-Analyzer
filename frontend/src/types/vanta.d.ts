declare module "vanta/dist/vanta.net.min" {
  interface VantaEffect {
    destroy: () => void;
  }

  interface VantaNetOptions {
    el: HTMLElement;
    THREE: unknown;
    mouseControls?: boolean;
    touchControls?: boolean;
    gyroControls?: boolean;
    minHeight?: number;
    minWidth?: number;
    scale?: number;
    scaleMobile?: number;
    color?: number;
    backgroundColor?: number;
    points?: number;
    maxDistance?: number;
    spacing?: number;
    showDots?: boolean;
  }

  const NET: (options: VantaNetOptions) => VantaEffect;

  export default NET;
}

declare module "vanta/dist/vanta.birds.min" {
  interface VantaEffect {
    destroy: () => void;
  }

  interface VantaBirdsOptions {
    el: HTMLElement;
    THREE: unknown;
    mouseControls?: boolean;
    touchControls?: boolean;
    gyroControls?: boolean;
    minHeight?: number;
    minWidth?: number;
    scale?: number;
    scaleMobile?: number;
    backgroundColor?: number;
    color1?: number;
    color2?: number;
    birdSize?: number;
    wingSpan?: number;
    speedLimit?: number;
    separation?: number;
    alignment?: number;
    cohesion?: number;
    quantity?: number;
  }

  const BIRDS: (options: VantaBirdsOptions) => VantaEffect;

  export default BIRDS;
}

declare module "vanta/dist/vanta.waves.min" {
  interface VantaEffect {
    destroy: () => void;
  }

  interface VantaWavesOptions {
    el: HTMLElement;
    THREE: unknown;
    mouseControls?: boolean;
    touchControls?: boolean;
    gyroControls?: boolean;
    minHeight?: number;
    minWidth?: number;
    scale?: number;
    scaleMobile?: number;
    color?: number;
    backgroundColor?: number;
    shininess?: number;
    waveHeight?: number;
    waveSpeed?: number;
    zoom?: number;
  }

  const WAVES: (options: VantaWavesOptions) => VantaEffect;

  export default WAVES;
}
