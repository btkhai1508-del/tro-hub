/**
 * Vector document engine shared by the on-screen preview and the PDF download.
 *
 * A document is a list of draw operations in PDF points, so the file the user downloads is
 * exactly what the preview shows and never depends on the surrounding website.
 *
 * Tinos is the open font with the same glyph widths as Times New Roman, which cannot be
 * redistributed with a web app.
 */

export const A4 = { width: 595.44, height: 841.92 };

export type FontStyle = 'normal' | 'bold' | 'italic' | 'bolditalic';

export type DrawOp =
  | { t: 'text'; x: number; y: number; s: string; style: FontStyle; size: number; cs?: number }
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; w: number; dash?: number[] }
  | { t: 'rect'; x: number; y: number; w: number; h: number; lw: number };

export interface BuiltDocument {
  title: string;
  fileName: string;
  pages: DrawOp[][];
  landscape?: boolean;
}

export const pageSize = (doc: Pick<BuiltDocument, 'landscape'>) =>
  doc.landscape ? { width: A4.height, height: A4.width } : A4;

export interface Measurer {
  width(text: string, style: FontStyle, size: number): number;
}

/** Text run; `rise` lifts superscripts. */
export interface TextRun {
  text: string;
  style?: FontStyle;
  size?: number;
  rise?: number;
}

/** A form blank: `dots` is the blank as printed; a known value replaces it entirely, in bold at the size of the text around it. */
export interface FieldRun {
  value?: string;
  dots: string;
  style?: FontStyle;
  size?: number;
  dotSize?: number;
}

export type Run = TextRun | FieldRun;

export const t = (text: string, style?: FontStyle, size?: number): TextRun => ({ text, style, size });
export const f = (value: string | undefined, dots: string, size?: number, dotSize?: number): FieldRun => ({ value, dots, size, dotSize });
export const sup = (text: string, size: number, style?: FontStyle, rise = 4.6): TextRun => ({ text, size, style, rise });

const FONT_FILES: Record<FontStyle, string> = {
  normal: 'Tinos-Regular.ttf',
  bold: 'Tinos-Bold.ttf',
  italic: 'Tinos-Italic.ttf',
  bolditalic: 'Tinos-BoldItalic.ttf',
};

const FONT_FAMILY = 'Tinos';

let fontsPromise: Promise<Record<FontStyle, ArrayBuffer>> | null = null;

function loadFontFiles() {
  if (!fontsPromise) {
    const styles = Object.keys(FONT_FILES) as FontStyle[];
    fontsPromise = Promise.all(
      styles.map(async style => {
        const res = await fetch(`${import.meta.env.BASE_URL}fonts/${FONT_FILES[style]}`);
        if (!res.ok) throw new Error(`Font ${FONT_FILES[style]} ${res.status}`);
        const buffer = await res.arrayBuffer();
        // Same font for the SVG preview, so its text lines up with the measured layout.
        const face = new FontFace(FONT_FAMILY, buffer.slice(0), {
          weight: style.includes('bold') ? '700' : '400',
          style: style.includes('italic') ? 'italic' : 'normal',
        });
        document.fonts.add(await face.load());
        return [style, buffer] as const;
      })
    )
      .then(entries => Object.fromEntries(entries) as Record<FontStyle, ArrayBuffer>)
      .catch(err => {
        fontsPromise = null;
        throw err;
      });
  }
  return fontsPromise;
}

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function createPdf(landscape = false) {
  const [{ jsPDF }, fonts] = await Promise.all([import('jspdf'), loadFontFiles()]);
  const pdf = new jsPDF({ unit: 'pt', format: [A4.width, A4.height], orientation: landscape ? 'landscape' : 'portrait' });
  (Object.keys(FONT_FILES) as FontStyle[]).forEach(style => {
    pdf.addFileToVFS(FONT_FILES[style], toBase64(fonts[style]));
    pdf.addFont(FONT_FILES[style], FONT_FAMILY, style);
  });
  return pdf;
}

let measurerPromise: Promise<Measurer> | null = null;

export function getMeasurer(): Promise<Measurer> {
  if (!measurerPromise) {
    measurerPromise = createPdf()
      .then(pdf => ({
        width(text: string, style: FontStyle, size: number) {
          pdf.setFont(FONT_FAMILY, style);
          pdf.setFontSize(size);
          return pdf.getTextWidth(text.normalize('NFC'));
        },
      }))
      .catch(err => {
        measurerPromise = null;
        throw err;
      });
  }
  return measurerPromise;
}

export async function renderPdfBlob(doc: BuiltDocument): Promise<Blob> {
  const pdf = await createPdf(doc.landscape);
  pdf.setProperties({ title: doc.title });
  pdf.setTextColor(0, 0, 0);
  pdf.setDrawColor(0, 0, 0);
  doc.pages.forEach((ops, index) => {
    if (index > 0) pdf.addPage([A4.width, A4.height], doc.landscape ? 'landscape' : 'portrait');
    ops.forEach(op => {
      if (op.t === 'text') {
        pdf.setFont(FONT_FAMILY, op.style);
        pdf.setFontSize(op.size);
        pdf.text(op.s.normalize('NFC'), op.x, op.y, op.cs ? { charSpace: op.cs } : undefined);
      } else if (op.t === 'line') {
        pdf.setLineWidth(op.w);
        pdf.setLineDashPattern(op.dash || [], 0);
        pdf.line(op.x1, op.y1, op.x2, op.y2);
        pdf.setLineDashPattern([], 0);
      } else {
        pdf.setLineWidth(op.lw);
        pdf.rect(op.x, op.y, op.w, op.h);
      }
    });
  });
  return pdf.output('blob');
}

const isField = (run: Run): run is FieldRun => 'dots' in run;

interface Piece { s: string; style: FontStyle; size: number; rise: number; w: number }
interface Atom { pieces: Piece[]; width: number; spaces: number }

export interface FlowOptions {
  x: number;
  right: number;
  y: number;
  lineHeight: number;
  firstX?: number;
  size: number;
  style?: FontStyle;
  align?: 'left' | 'justify' | 'center';
}

/** Lays out text and form blanks with word wrap; a blank keeps its printed width when it can. */
export class PageWriter {
  pages: DrawOp[][] = [[]];
  /** Moves everything written after it down, for a line that had to wrap. */
  dy = 0;
  constructor(readonly m: Measurer) {}

  get ops() { return this.pages[this.pages.length - 1]; }
  addPage() { this.pages.push([]); }

  text(x: number, y: number, s: string, size: number, style: FontStyle = 'normal') {
    this.ops.push({ t: 'text', x, y: y + this.dy, s, style, size });
  }
  /** Text set to the exact span of the template line (Word condenses some of them). */
  span(x: number, end: number, y: number, s: string, size: number, style: FontStyle = 'normal') {
    const chars = [...s.normalize('NFC')].length;
    const cs = chars > 1 ? (end - x - this.m.width(s, style, size)) / (chars - 1) : 0;
    this.ops.push({ t: 'text', x, y: y + this.dy, s, style, size, cs: Math.abs(cs) > 0.001 ? cs : undefined });
  }
  center(cx: number, y: number, s: string, size: number, style: FontStyle = 'normal') {
    this.text(cx - this.m.width(s, style, size) / 2, y, s, size, style);
  }
  rightText(rx: number, y: number, s: string, size: number, style: FontStyle = 'normal') {
    this.text(rx - this.m.width(s, style, size), y, s, size, style);
  }
  line(x1: number, y1: number, x2: number, y2: number, w = 0.5, dash?: number[]) {
    this.ops.push({ t: 'line', x1, y1: y1 + this.dy, x2, y2: y2 + this.dy, w, dash });
  }
  rect(x: number, y: number, w: number, h: number, lw = 0.5) {
    this.ops.push({ t: 'rect', x, y: y + this.dy, w, h, lw });
  }

  private fieldPieces(run: FieldRun, base: { size: number; style: FontStyle }): Piece[] {
    const make = (s: string, style: FontStyle, size: number): Piece => ({ s, style, size, rise: 0, w: this.m.width(s, style, size) });
    const value = (run.value || '').trim();
    if (value) return [make(value, 'bold', base.size)];
    return [make(run.dots, run.style || base.style, run.dotSize || run.size || base.size)];
  }

  /** Width of runs on one line, used to decide whether two items still fit side by side. */
  measure(runs: Run[], size: number) {
    const spaceWidth = this.m.width(' ', 'normal', size);
    return this.toAtoms(runs, { size, style: 'normal' }).reduce((sum, atom, i) => sum + atom.width + (i ? atom.spaces * spaceWidth : 0), 0);
  }

  private toAtoms(runs: Run[], base: { size: number; style: FontStyle }): Atom[] {
    const atoms: Atom[] = [];
    let current: Atom | null = null;
    let pendingSpaces = 0;
    const push = (pieces: Piece[]) => {
      if (!current || pendingSpaces > 0) {
        current = { pieces: [], width: 0, spaces: pendingSpaces };
        atoms.push(current);
        pendingSpaces = 0;
      }
      current.pieces.push(...pieces);
      current.width += pieces.reduce((sum, piece) => sum + piece.w, 0);
    };
    runs.forEach(run => {
      if (isField(run)) {
        push(this.fieldPieces(run, base));
        return;
      }
      const style = run.style || base.style;
      const size = run.size || base.size;
      const rise = run.rise || 0;
      run.text.split(/( +)/).forEach(part => {
        if (!part) return;
        if (part[0] === ' ') {
          pendingSpaces += part.length;
          current = null;
        } else {
          push([{ s: part, style, size, rise, w: this.m.width(part, style, size) }]);
        }
      });
    });
    return atoms;
  }

  /** Writes a paragraph and returns the baseline of the line after it. */
  flow(runs: Run[], opt: FlowOptions): number {
    const style = opt.style || 'normal';
    const atoms = this.toAtoms(runs, { size: opt.size, style });
    const spaceWidth = this.m.width(' ', 'normal', opt.size);
    const lines: Atom[][] = [];
    let line: Atom[] = [];
    let used = 0;
    let startX = opt.firstX ?? opt.x;
    atoms.forEach(atom => {
      const gap = line.length ? atom.spaces * spaceWidth : 0;
      if (line.length && startX + used + gap + atom.width > opt.right + 0.01) {
        lines.push(line);
        line = [];
        used = 0;
        startX = opt.x;
        used = atom.width;
        line.push(atom);
        return;
      }
      used += gap + atom.width;
      line.push(atom);
    });
    if (line.length) lines.push(line);

    let y = opt.y;
    lines.forEach((atomsInLine, index) => {
      const lineX = index === 0 ? opt.firstX ?? opt.x : opt.x;
      const natural = atomsInLine.reduce((sum, atom, i) => sum + atom.width + (i ? atom.spaces * spaceWidth : 0), 0);
      const totalSpaces = atomsInLine.reduce((sum, atom, i) => sum + (i ? atom.spaces : 0), 0);
      const isLast = index === lines.length - 1;
      const extra = opt.align === 'justify' && !isLast && totalSpaces ? (opt.right - lineX - natural) / totalSpaces : 0;
      let x = opt.align === 'center' ? lineX + (opt.right - lineX - natural) / 2 : lineX;
      atomsInLine.forEach((atom, i) => {
        if (i) x += atom.spaces * (spaceWidth + extra);
        atom.pieces.forEach(piece => {
          this.ops.push({ t: 'text', x, y: y - piece.rise + this.dy, s: piece.s, style: piece.style, size: piece.size });
          x += piece.w;
        });
      });
      y += opt.lineHeight;
    });
    return y;
  }

  /** Writes one line of runs from a fixed start, with no wrap. */
  at(x: number, y: number, runs: Run[], size: number) {
    this.flow(runs, { x, right: 100000, y, lineHeight: 0, size });
  }
}
