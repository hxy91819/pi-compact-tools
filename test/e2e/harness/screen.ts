/**
 * Minimal ANSI screen emulator.
 *
 * Pi's TUI repaints by moving the cursor and overwriting fragments, so grepping
 * the raw byte stream produces assertions that depend on repaint timing. This
 * replays the stream onto a character grid so tests can assert on the screen a
 * user would actually see.
 *
 * Fullscreen mode renders into the alternate screen buffer and disables
 * autowrap while painting, so both are modelled — otherwise rows land on the
 * wrong line and the "this text is gone" assertions become unreliable.
 *
 * Only the sequences Pi's TUI emits are handled; anything unrecognized is
 * ignored so an unexpected escape never corrupts the grid.
 */

const CSI_FINAL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@`";

export class Screen {
  private grid: string[][];
  private row = 0;
  private col = 0;
  private savedRow = 0;
  private savedCol = 0;
  private pending = "";
  private pos = 0;
  private readonly rows: number;
  private readonly cols: number;
  private altGrid: string[][] | undefined;
  private altRow = 0;
  private altCol = 0;
  private autowrap = true;

  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.grid = Screen.blank(rows, cols);
  }

  private static blank(rows: number, cols: number): string[][] {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => " "));
  }

  write(chunk: string): void {
    this.pending += chunk;

    // Parsing walks a cursor instead of re-slicing the buffer, so a long
    // session costs one pass rather than a copy per character.
    while (this.pos < this.pending.length) {
      const before = this.pos;
      this.step();
      // Only an incomplete escape at the end of the buffer leaves the cursor
      // untouched; it will be completed by a later chunk.
      if (this.pos === before) break;
    }

    if (this.pos > 0) {
      this.pending = this.pending.slice(this.pos);
      this.pos = 0;
    }
  }

  private step(): void {
    const data = this.pending;

    if (data[this.pos] !== "\x1b") {
      this.put(data[this.pos]!);
      this.pos += 1;
      return;
    }

    if (this.pos + 1 >= data.length) return;

    const second = data[this.pos + 1]!;

    if (second === "[") {
      const end = this.findCsiEnd();
      if (end === -1) return;
      this.handleCsi(data.slice(this.pos + 2, end), data[end]!);
      this.pos = end + 1;
      return;
    }

    if (second === "]") {
      const end = this.findStringTerminator(this.pos + 2);
      if (end === -1) return;
      this.pos = end;
      return;
    }

    // DCS / APC / PM / SOS: consume through the string terminator and ignore.
    if (second === "P" || second === "_" || second === "^" || second === "X") {
      const end = this.findStringTerminator(this.pos + 2);
      if (end === -1) return;
      this.pos = end;
      return;
    }

    if (second === "7") {
      this.savedRow = this.row;
      this.savedCol = this.col;
    } else if (second === "8") {
      this.row = this.savedRow;
      this.col = this.savedCol;
    }

    // ESC =, ESC >, ESC ( B and similar: consume the two-character sequence.
    this.pos += 2;
  }

  private findCsiEnd(): number {
    const data = this.pending;
    for (let i = this.pos + 2; i < data.length; i += 1) {
      const char = data[i]!;
      if (char >= "\x30" && char <= "\x3f") continue; // parameter and intermediate bytes
      if (CSI_FINAL.includes(char)) return i;
      // Illegal byte: abort so the sequence is not misread as a later one.
      return -1;
    }
    return -1;
  }

  private findStringTerminator(from: number): number {
    const data = this.pending;
    for (let i = from; i < data.length; i += 1) {
      if (data[i] === "\x07") return i + 1;
      if (data[i] === "\x1b" && data[i + 1] === "\\") return i + 2;
    }
    return -1;
  }

  private handleCsi(body: string, final: string): void {
    if (body.startsWith("?")) {
      this.handlePrivateMode(body.slice(1).split(";").map((part) => Number.parseInt(part, 10)), final);
      return;
    }

    const args = body.split(";").map((part) => Number.parseInt(part, 10));
    const at = (index: number, fallback: number): number => {
      const value = args[index];
      return value === undefined || Number.isNaN(value) ? fallback : value;
    };

    switch (final) {
      case "A":
        this.row = Math.max(0, this.row - at(0, 1));
        return;
      case "B":
        this.row = Math.min(this.rows - 1, this.row + at(0, 1));
        return;
      case "C":
        this.col = Math.min(this.cols - 1, this.col + at(0, 1));
        return;
      case "D":
        this.col = Math.max(0, this.col - at(0, 1));
        return;
      case "E":
        this.row = Math.min(this.rows - 1, this.row + at(0, 1));
        this.col = 0;
        return;
      case "F":
        this.row = Math.max(0, this.row - at(0, 1));
        this.col = 0;
        return;
      case "G":
        this.col = Math.min(this.cols - 1, at(0, 1) - 1);
        return;
      case "H":
      case "f":
        this.row = Math.min(this.rows - 1, at(0, 1) - 1);
        this.col = Math.min(this.cols - 1, at(1, 1) - 1);
        return;
      case "J": {
        const mode = at(0, 0);
        if (mode === 0) {
          this.clearRange(this.row, this.col, this.rows - 1, this.cols - 1);
        } else if (mode === 2 || mode === 3) {
          this.grid = Screen.blank(this.rows, this.cols);
          if (mode === 2) {
            this.row = 0;
            this.col = 0;
          }
        }
        return;
      }
      case "K": {
        const mode = at(0, 0);
        if (mode === 0) this.clearRange(this.row, this.col, this.row, this.cols - 1);
        else if (mode === 1) this.clearRange(this.row, 0, this.row, this.col);
        else this.clearRange(this.row, 0, this.row, this.cols - 1);
        return;
      }
      case "L":
        this.insertLines(at(0, 1));
        return;
      case "M":
        this.deleteLines(at(0, 1));
        return;
      default:
        // SGR, private modes, keyboard protocol toggles: rendering state we ignore.
        return;
    }
  }

  private handlePrivateMode(modes: number[], final: string): void {
    const enabled = final === "h";
    for (const mode of modes) {
      if (mode === 1049) {
        if (enabled) {
          this.altGrid = this.grid;
          this.altRow = this.row;
          this.altCol = this.col;
          this.grid = Screen.blank(this.rows, this.cols);
          this.row = 0;
          this.col = 0;
        } else if (this.altGrid) {
          this.grid = this.altGrid;
          this.row = this.altRow;
          this.col = this.altCol;
          this.altGrid = undefined;
        }
      } else if (mode === 7) {
        this.autowrap = enabled;
      }
    }
  }

  private clearRange(fromRow: number, fromCol: number, toRow: number, toCol: number): void {
    for (let r = Math.max(0, fromRow); r <= Math.min(this.rows - 1, toRow); r += 1) {
      for (let c = Math.max(0, fromCol); c <= Math.min(this.cols - 1, toCol); c += 1) {
        this.grid[r]![c] = " ";
      }
    }
  }

  private insertLines(count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.grid.splice(this.row, 0, Array.from({ length: this.cols }, () => " "));
      this.grid.pop();
    }
    this.col = 0;
  }

  private deleteLines(count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.grid.splice(this.row, 1);
      this.grid.push(Array.from({ length: this.cols }, () => " "));
    }
    this.col = 0;
  }

  private put(char: string): void {
    switch (char) {
      case "\r":
        this.col = 0;
        return;
      case "\n":
        this.row += 1;
        if (this.row >= this.rows) {
          this.grid.shift();
          this.grid.push(Array.from({ length: this.cols }, () => " "));
          this.row = this.rows - 1;
        }
        return;
      case "\b":
        this.col = Math.max(0, this.col - 1);
        return;
      case "\t":
        this.col = Math.min(this.cols - 1, (Math.floor(this.col / 8) + 1) * 8);
        return;
      case "\x00":
      case "\x07":
        return;
      default:
        break;
    }

    if (char < " ") return;

    if (this.col >= this.cols) {
      if (!this.autowrap) {
        // With autowrap off the last column keeps overwriting itself.
        this.grid[this.row]![this.cols - 1] = char;
        return;
      }
      this.col = 0;
      this.row += 1;
      if (this.row >= this.rows) {
        this.grid.shift();
        this.grid.push(Array.from({ length: this.cols }, () => " "));
        this.row = this.rows - 1;
      }
    }

    this.grid[this.row]![this.col] = char;
    this.col += 1;
  }

  /** Screen contents, one string per row, with trailing padding removed. */
  lines(): string[] {
    return this.grid.map((row) => row.join("").replace(/\s+$/, ""));
  }

  /** Screen contents as a single block of text, blank lines removed. */
  text(): string {
    return this.lines()
      .filter((line) => line.length > 0)
      .join("\n");
  }
}
