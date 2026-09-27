import { describe, expect, test } from "bun:test";
import { detectDelimiter, parseCsv, previewCsv } from "./csv";

describe("parseCsv", () => {
  test("splits plain comma rows", () => {
    expect(parseCsv("a,b,c\n1,2,3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("handles quoted cells with commas, escaped quotes and embedded newlines", () => {
    const text = 'name,note\n"Doe, Jane","said ""hi""\nnext line"';
    expect(parseCsv(text, ",")).toEqual([
      ["name", "note"],
      ["Doe, Jane", 'said "hi"\nnext line'],
    ]);
  });

  test("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("strips a leading BOM", () => {
    expect(parseCsv("﻿a,b\n1,2", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("respects a semicolon or tab delimiter, ignoring commas", () => {
    expect(parseCsv("a;b\n1,5;2", ";")).toEqual([
      ["a", "b"],
      ["1,5", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("drops a single trailing blank line from a final newline", () => {
    expect(parseCsv("a,b\n1,2\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("detectDelimiter", () => {
  test("picks comma for a comma-separated header", () => {
    expect(detectDelimiter("date,amount,note\n2026-01-01,10,lunch")).toBe(",");
  });

  test("picks semicolon for a semicolon-separated (e.g. Indonesian bank) export", () => {
    expect(detectDelimiter("tanggal;jumlah;keterangan\n01/01/2026;10.000;makan siang")).toBe(";");
  });

  test("picks tab when the header is tab-separated", () => {
    expect(detectDelimiter("date\tamount\tnote\n2026-01-01\t10\tlunch")).toBe("\t");
  });

  test("falls back to comma when nothing else matches", () => {
    expect(detectDelimiter("just one column")).toBe(",");
  });

  test("ignores delimiter characters inside quotes", () => {
    expect(detectDelimiter('"a;b;c";d;e')).toBe(";");
  });
});

describe("previewCsv", () => {
  test("auto-detects the delimiter and pads ragged rows to a common width", () => {
    const { delimiter, rows } = previewCsv("date;amount;note\n2026-01-01;10;lunch\n2026-01-02;20");
    expect(delimiter).toBe(";");
    expect(rows).toEqual([
      ["date", "amount", "note"],
      ["2026-01-01", "10", "lunch"],
      ["2026-01-02", "20", ""],
    ]);
  });

  test("caps at maxRows", () => {
    const text = Array.from({ length: 30 }, (_, i) => `row${i}`).join("\n");
    expect(previewCsv(text, 5).rows).toHaveLength(5);
  });
});
