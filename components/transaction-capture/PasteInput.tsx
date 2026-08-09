"use client";

import { useRef, useState, type ChangeEvent } from "react";
import {
  MAX_DRAFT_ROWS,
  MAX_PASTE_BYTES
} from "@/lib/transaction-drafts/paste";

type PasteInputProps = {
  value: string;
  byteCount: number;
  rowCount: number | null;
  error: string | null;
  onTextChange: (value: string) => void;
  onInputError: (message: string) => void;
};

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("File did not contain text."));
      }
    });
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsText(file);
  });
}

export function PasteInput({
  value,
  byteCount,
  rowCount,
  error,
  onTextChange,
  onInputError
}: PasteInputProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [readingClipboard, setReadingClipboard] = useState(false);

  async function pasteFromClipboard() {
    setReadingClipboard(true);
    try {
      onTextChange(await navigator.clipboard.readText());
    } catch {
      onInputError(
        "Clipboard access was blocked. Paste into the text box with your keyboard instead."
      );
    } finally {
      setReadingClipboard(false);
    }
  }

  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const extension = file.name.toLowerCase().split(".").pop();
    if (extension !== "csv" && extension !== "tsv") {
      onInputError("Choose a .csv or .tsv text file.");
      event.target.value = "";
      return;
    }

    if (file.size > MAX_PASTE_BYTES) {
      onInputError(
        "File cannot exceed 1,000,000 UTF-8 bytes. Choose a smaller file or split the batch."
      );
      event.target.value = "";
      return;
    }

    try {
      onTextChange(await readFileAsText(file));
    } catch {
      onInputError(
        "The file could not be read as text. Export it as CSV or TSV and try again."
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <div className="mt-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <label
            className="block text-sm font-semibold text-capture-ink"
            htmlFor="transaction-paste-input"
          >
            Paste spreadsheet rows
          </label>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Include headings when you can. Example: Ngày giao dịch, Nội dung,
            Số tiền.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="min-h-11 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-capture-primary hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-capture-primary disabled:text-slate-400"
            disabled={readingClipboard}
            onClick={pasteFromClipboard}
            type="button"
          >
            {readingClipboard ? "Reading clipboard…" : "Paste from clipboard"}
          </button>
          <label className="flex min-h-11 cursor-pointer items-center rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-capture-primary hover:bg-slate-50 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-capture-primary">
            Choose file
            <input
              accept=".csv,.tsv,text/csv,text/tab-separated-values"
              aria-label="Choose CSV or TSV file"
              className="sr-only"
              onChange={readFile}
              ref={fileInputRef}
              type="file"
            />
          </label>
        </div>
      </div>

      <textarea
        aria-describedby="transaction-paste-help transaction-paste-counts"
        className="mt-3 min-h-44 w-full resize-y rounded-lg border border-slate-300 bg-slate-50 px-3 py-3 font-capture-data text-sm leading-6 text-capture-ink placeholder:text-slate-400 focus:border-capture-primary focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100"
        id="transaction-paste-input"
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={
          "Ngày giao dịch\tNội dung\tSố tiền\n2026-08-03\tCà phê sáng\t45000"
        }
        spellCheck={false}
        value={value}
      />

      <div
        className="mt-2 flex flex-wrap justify-between gap-2 font-capture-data text-xs text-slate-500"
        id="transaction-paste-counts"
      >
        <span>
          {rowCount === null ? "—" : rowCount} / {MAX_DRAFT_ROWS} rows
        </span>
        <span>
          {byteCount.toLocaleString("en-US")} /{" "}
          {MAX_PASTE_BYTES.toLocaleString("en-US")} bytes
        </span>
      </div>
      <p className="sr-only" id="transaction-paste-help">
        Paste comma-separated or tab-separated text. Values remain text until
        server validation.
      </p>

      {error ? (
        <p
          className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm leading-5 text-capture-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
