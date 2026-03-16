import test from "node:test";
import assert from "node:assert/strict";

import { deriveOcrProgress, deriveProgressFromStatusHint } from "../src/core/ocr.js";

test("deriveProgressFromStatusHint maps known OCR stages", () => {
  assert.equal(deriveProgressFromStatusHint("initializing tesseract"), 0.04);
  assert.equal(deriveProgressFromStatusHint("loaded language traineddata"), 0.6);
  assert.equal(deriveProgressFromStatusHint("recognizing text"), 0.7);
  assert.equal(deriveProgressFromStatusHint("unknown stage"), null);
});

test("deriveOcrProgress keeps progress monotonic and uses explicit values", () => {
  assert.equal(deriveOcrProgress("recognizing text", 0.2, 0), 0.2);
  assert.equal(deriveOcrProgress("recognizing text", 0.1, 0.2), 0.2);
  assert.equal(deriveOcrProgress("recognizing text", 1.2, 0.8), 1);
});

test("deriveOcrProgress uses status hints when raw progress is missing", () => {
  assert.equal(deriveOcrProgress("initializing api", undefined, 0.05), 0.26);
  assert.equal(deriveOcrProgress("unmapped stage", undefined, 0.26), 0.26);
});

test("deriveOcrProgress caps misleading explicit values for early OCR stages", () => {
  assert.equal(deriveOcrProgress("initializing tesseract", 1, 0), 0.12);
  assert.equal(deriveOcrProgress("loaded language traineddata", 1, 0.4), 0.82);
  assert.equal(deriveOcrProgress("ocr complete", 1, 0.82), 1);
});

test("deriveOcrProgress survives noisy OCR logger sequences", () => {
  const sequence = [
    { status: "initializing tesseract", progress: 1 },
    { status: "loading tesseract core", progress: undefined },
    { status: "loaded tesseract core", progress: 0 },
    { status: "initializing api", progress: NaN },
    { status: "loading language traineddata", progress: undefined },
    { status: "loaded language traineddata", progress: 1 },
    { status: "recognizing text", progress: 0.35 },
    { status: "recognizing text", progress: 0.88 },
    { status: "ocr complete", progress: undefined },
  ];

  const outputs = [];
  let current = 0;
  for (const event of sequence) {
    current = deriveOcrProgress(event.status, event.progress, current);
    outputs.push(current);
  }

  for (let i = 1; i < outputs.length; i += 1) {
    assert.ok(outputs[i] >= outputs[i - 1], `progress regressed at step ${i}: ${outputs[i - 1]} -> ${outputs[i]}`);
  }
  assert.equal(outputs[0], 0.12);
  assert.equal(outputs[5], 0.82);
  assert.equal(outputs[outputs.length - 1], 1);
});

test("deriveOcrProgress uses stage hints when explicit progress is zero", () => {
  assert.equal(deriveOcrProgress("loading language traineddata", 0, 0.3), 0.45);
  assert.equal(deriveOcrProgress("loaded language traineddata", 0, 0.45), 0.6);
});
