// ==========================================
// 📝 1. テキスト折り返し（純ロジック / Canvas 非依存）
// ==========================================
// 📝 描画幅の計測関数を引数で受け取ることで、Canvas を使わずに単体テスト
// できるようにしたモジュール。日本語の禁則処理（行頭禁則・行末禁則）の
// 簡易版もここで扱う。
import type { ResolvedToken } from "./emoji.js";

// 🚫 行頭に置けない文字（句読点・閉じ括弧・長音など）
const NO_LINE_START =
  "、。，．！？：；）」』】〉》ー〜…‥・ゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ";

// 🚫 行末に残せない文字（開き括弧）
const NO_LINE_END = "（「『【〈《";

// 📏 文字列の描画幅を返す関数（measureText の薄いラッパ）
export type MeasureFn = (text: string) => number;

// ------------------------------------------
// 🔤 コードポイント単位のヘルパ
// ------------------------------------------
// 🔤 絵文字などは UTF-16 のサロゲートペア（2コードユニット）で表される
// ため、length や slice のようなコードユニット単位の末尾操作で切ると
// 片方だけが残って描画が壊れる。末尾操作はすべてこちらに統一する。

// 🔤 末尾の1文字（コードポイント）を返す
export function lastCodePoint(text: string): string | undefined {
  return [...text].at(-1);
}

// ✂️ 末尾の1文字（コードポイント）を落とした文字列を返す
export function dropLastCodePoint(text: string): string {
  const chars = [...text];
  chars.pop();
  return chars.join("");
}

// 🔢 コードポイント単位の文字数を返す
export function codePointLength(text: string): number {
  return [...text].length;
}

// ------------------------------------------
// 📝 プレーンなテキストの折り返し
// ------------------------------------------
// 📝 text を maxWidth に収まる行の配列に分割する。
// 改行は段落区切りとして尊重する。
export function wrapText(
  text: string,
  maxWidth: number,
  measure: MeasureFn,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let line = "";
    for (const ch of paragraph) {
      if (line === "") {
        // 🧹 行頭の空白は捨てる
        if (ch === " " || ch === "　") continue;
        line = ch;
        continue;
      }
      if (measure(line + ch) <= maxWidth) {
        line += ch;
        continue;
      }
      // ↩️ ここで折り返しが発生する
      if (NO_LINE_START.includes(ch)) {
        // 🚫 行頭禁則: その文字は前の行に追い込む（多少はみ出しても崩さない）
        line += ch;
        continue;
      }
      const last = lastCodePoint(line);
      if (
        last !== undefined &&
        NO_LINE_END.includes(last) &&
        codePointLength(line) >= 2
      ) {
        // 🚫 行末禁則: 開き括弧は次の行へ送る
        lines.push(dropLastCodePoint(line));
        line = last + ch;
        continue;
      }
      lines.push(line);
      line = ch === " " || ch === "　" ? "" : ch;
    }
    if (line !== "" || lines.length === 0) lines.push(line);
  }
  return lines;
}

// ------------------------------------------
// 🔍 サイズ自動調整（プレーン）
// ------------------------------------------
// 🔍 計測は行全体を毎回測る方式にする（カーニング等の影響を受けるため、
// 文字単位の幅の合算には置き換えない）。処理量は文字数に対して増えるが、
// 入力は guard.ts の上限（最大300文字）で絞られている。
export interface FitOptions {
  maxWidth: number;
  maxHeight: number;
  // 🔠 大きい順に試すフォントサイズ
  sizes: number[];
  // 📏 行高（フォントサイズに対する倍率）
  lineHeightRatio: number;
  // 🏭 サイズごとの計測関数を作るファクトリ
  measureAt: (fontSize: number) => MeasureFn;
}

export interface FitResult {
  fontSize: number;
  lines: string[];
  lineHeight: number;
}

// 🔍 maxWidth × maxHeight に収まる最大のフォントサイズと折り返し結果を
// 返す。最小サイズでも収まらない場合は、入る行数までで切り捨てて
// 末尾に … を付ける。
export function fitQuoteText(text: string, opts: FitOptions): FitResult {
  const sizes = [...opts.sizes].sort((a, b) => b - a);
  for (const size of sizes) {
    const lines = wrapText(text, opts.maxWidth, opts.measureAt(size));
    const lineHeight = Math.round(size * opts.lineHeightRatio);
    if (lines.length * lineHeight <= opts.maxHeight) {
      return { fontSize: size, lines, lineHeight };
    }
  }
  const size = sizes[sizes.length - 1];
  const lineHeight = Math.round(size * opts.lineHeightRatio);
  const maxLines = Math.max(1, Math.floor(opts.maxHeight / lineHeight));
  const measure = opts.measureAt(size);
  const lines = wrapText(text, opts.maxWidth, measure).slice(0, maxLines);
  // ✂️ 最終行に … を付ける（幅に収まるまで末尾を削る）
  let last = lines[lines.length - 1];
  while (last.length > 0 && measure(last + "…") > opts.maxWidth) {
    last = dropLastCodePoint(last);
  }
  lines[lines.length - 1] = last + "…";
  return { fontSize: size, lines, lineHeight };
}

// ------------------------------------------
// 😀 絵文字トークンを含む折り返し
// ------------------------------------------
// 😀 emoji.ts で解決済みのトークン列（テキスト / 画像）を行に分割する。
// テキスト部分は文字（コードポイント）単位、画像は分割不能な1単位として
// 扱い、幅は「連続するテキストの実測 + 画像はフォントサイズ相当の
// 正方形」として数える。禁則処理は wrapText と同じ規則を、文字単位の
// 単位列に対して適用する。

type Atom =
  | { kind: "char"; ch: string }
  | {
      kind: "image";
      raw: string;
      image: Extract<ResolvedToken, { kind: "image" }>["image"];
    };

// 🔀 トークン列を単位列に展開する（改行は段落区切りとして別に扱うため、
// ここでは段落ごとに呼ばれる前提で、テキスト内の改行は呼び出し側で
// 処理する）
function toAtoms(tokens: ResolvedToken[]): Atom[] {
  const atoms: Atom[] = [];
  for (const token of tokens) {
    if (token.kind === "text") {
      for (const ch of token.text) atoms.push({ kind: "char", ch });
    } else {
      atoms.push({ kind: "image", raw: token.raw, image: token.image });
    }
  }
  return atoms;
}

// 🔀 単位列からトークン列に戻す（連続する文字は1つのテキストにまとめる）
function fromAtoms(atoms: Atom[]): ResolvedToken[] {
  const tokens: ResolvedToken[] = [];
  for (const atom of atoms) {
    if (atom.kind === "char") {
      const last = tokens[tokens.length - 1];
      if (last && last.kind === "text") last.text += atom.ch;
      else tokens.push({ kind: "text", text: atom.ch });
    } else {
      tokens.push({ kind: "image", raw: atom.raw, image: atom.image });
    }
  }
  return tokens;
}

// 📏 1行（単位列）の描画幅。テキストは連続部分ごとに実測し、画像は
// emojiWidth を加える。
export function measureRichAtoms(
  atoms: Atom[],
  measure: MeasureFn,
  emojiWidth: number,
): number {
  let width = 0;
  let run = "";
  const flush = () => {
    if (run !== "") {
      width += measure(run);
      run = "";
    }
  };
  for (const atom of atoms) {
    if (atom.kind === "char") run += atom.ch;
    else {
      flush();
      width += emojiWidth;
    }
  }
  flush();
  return width;
}

// 📏 1行（トークン列）の描画幅を返す
export function measureRichLine(
  line: ResolvedToken[],
  measure: MeasureFn,
  emojiWidth: number,
): number {
  return measureRichAtoms(toAtoms(line), measure, emojiWidth);
}

// ✂️ テキスト内の改行で段落に分けたトークン列の配列を返す
function splitParagraphs(tokens: ResolvedToken[]): ResolvedToken[][] {
  const paragraphs: ResolvedToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind !== "text") {
      paragraphs[paragraphs.length - 1].push(token);
      continue;
    }
    const parts = token.text.split(/\r?\n/);
    parts.forEach((part, i) => {
      if (i > 0) paragraphs.push([]);
      if (part !== "") {
        paragraphs[paragraphs.length - 1].push({ kind: "text", text: part });
      }
    });
  }
  return paragraphs;
}

// 📝 トークン列を maxWidth に収まる行（トークン列の配列）に分割する
export function wrapRichText(
  tokens: ResolvedToken[],
  maxWidth: number,
  measure: MeasureFn,
  emojiWidth: number,
): ResolvedToken[][] {
  const lines: Atom[][] = [];
  for (const paragraph of splitParagraphs(tokens)) {
    const atoms = toAtoms(paragraph);
    if (atoms.length === 0) {
      lines.push([]);
      continue;
    }
    let line: Atom[] = [];
    const lineWidth = (candidate: Atom[]) =>
      measureRichAtoms(candidate, measure, emojiWidth);
    for (const atom of atoms) {
      if (line.length === 0) {
        // 🧹 行頭の空白は捨てる（画像は対象外）
        if (atom.kind === "char" && (atom.ch === " " || atom.ch === "　")) {
          continue;
        }
        line = [atom];
        continue;
      }
      if (lineWidth([...line, atom]) <= maxWidth) {
        line.push(atom);
        continue;
      }
      // ↩️ ここで折り返しが発生する
      if (atom.kind === "char" && NO_LINE_START.includes(atom.ch)) {
        // 🚫 行頭禁則: その文字は前の行に追い込む
        line.push(atom);
        continue;
      }
      const last = line[line.length - 1];
      if (
        last &&
        last.kind === "char" &&
        NO_LINE_END.includes(last.ch) &&
        line.length >= 2
      ) {
        // 🚫 行末禁則: 開き括弧は次の行へ送る
        lines.push(line.slice(0, -1));
        line = [last, atom];
        continue;
      }
      lines.push(line);
      line =
        atom.kind === "char" && (atom.ch === " " || atom.ch === "　")
          ? []
          : [atom];
    }
    if (line.length > 0 || lines.length === 0) lines.push(line);
  }
  return lines.map(fromAtoms);
}

export interface RichFitResult {
  fontSize: number;
  lines: ResolvedToken[][];
  lineHeight: number;
}

// 🔍 fitQuoteText のトークン版。絵文字はフォントサイズ相当の正方形として
// 扱う。
export function fitRichText(
  tokens: ResolvedToken[],
  opts: FitOptions,
): RichFitResult {
  const sizes = [...opts.sizes].sort((a, b) => b - a);
  for (const size of sizes) {
    const lines = wrapRichText(
      tokens,
      opts.maxWidth,
      opts.measureAt(size),
      size,
    );
    const lineHeight = Math.round(size * opts.lineHeightRatio);
    if (lines.length * lineHeight <= opts.maxHeight) {
      return { fontSize: size, lines, lineHeight };
    }
  }
  const size = sizes[sizes.length - 1];
  const lineHeight = Math.round(size * opts.lineHeightRatio);
  const maxLines = Math.max(1, Math.floor(opts.maxHeight / lineHeight));
  const measure = opts.measureAt(size);
  const lines = wrapRichText(tokens, opts.maxWidth, measure, size).slice(
    0,
    maxLines,
  );
  // ✂️ 最終行に … を付ける（幅に収まるまで末尾の単位を削る）
  const lastAtoms = toAtoms(lines[lines.length - 1]);
  const ellipsis: Atom = { kind: "char", ch: "…" };
  while (
    lastAtoms.length > 0 &&
    measureRichAtoms([...lastAtoms, ellipsis], measure, size) > opts.maxWidth
  ) {
    lastAtoms.pop();
  }
  lastAtoms.push(ellipsis);
  lines[lines.length - 1] = fromAtoms(lastAtoms);
  return { fontSize: size, lines, lineHeight };
}
