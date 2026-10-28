declare module 'milsymbol' {
  export interface SymbolOptions {
    size?: number;
    frame?: boolean;
    fill?: boolean;
    strokeWidth?: number;
    monoColor?: string;
    outlineColor?: string;
    outlineWidth?: number;
    infoFields?: boolean;
    uniqueDesignation?: string;
    higherFormation?: string;
    speed?: string;
    direction?: number;
    altitudeDepth?: string;
    staffComments?: string;
    additionalInformation?: string;
    [key: string]: unknown;
  }

  export class Symbol {
    constructor(sidc: string, options?: SymbolOptions);
    asCanvas(ratio?: number): HTMLCanvasElement;
    asSVG(): string;
    getAnchor(): { x: number; y: number };
    getSize(): { width: number; height: number };
    getOctagonAnchor(): { x: number; y: number };
  }

  const ms: {
    Symbol: typeof Symbol;
    [key: string]: unknown;
  };

  export default ms;
}
