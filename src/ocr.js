import { createLogger } from "./logger.js";

const OCR_PRIMARY_LANG = "eng";
const OCR_TOTAL_TIMEOUT_MS = 60_000;
const OCR_WORKER_INIT_TIMEOUT_MS = 120_000;
const OCR_WORKER_ATTEMPT_TIMEOUT_MS = 20_000;
const OCR_ONESHOT_ATTEMPT_TIMEOUT_MS = 20_000;
const OCR_SCRIPT_LOAD_TIMEOUT_MS = 12_000;
const OCR_PROFILE_PREFLIGHT_TIMEOUT_MS = 4_000;
const OCR_RETRY_QUALITY_THRESHOLD = 58;
const OCR_DEEP_RESCUE_QUALITY_THRESHOLD = 46;
const OCR_DEEP_RESCUE_MIN_TEXT_LENGTH = 12;
const OCR_DESKEW_MIN_ABS_ANGLE_DEG = 0.4;
const OCR_DESKEW_MAX_ABS_ANGLE_DEG = 3.2;
const OCR_DESKEW_STEP_DEG = 0.4;
const OCR_FAST_PROFILE_ATTEMPT_TIMEOUT_MS = 9_000;
const OCR_DEEP_PROFILE_ATTEMPT_TIMEOUT_MS = 14_000;
const OCR_LATENCY_BUDGET_MS = 14_000;

const OCR_PROFILES = [
  {
    name: "cdn-fast",
    workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js",
    corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@v5.1.1",
    langPath: "https://tessdata.projectnaptha.com/4.0.0_fast",
    workerBlobURL: true,
  },
  {
    name: "local-standard",
    workerPath: "/vendor/ocr/worker.min.js",
    corePath: "/vendor/ocr/tesseract-core",
    langPath: "/vendor/ocr/tessdata/eng/4.0.0",
    workerBlobURL: false,
  },
  {
    name: "local-best-int",
    workerPath: "/vendor/ocr/worker.min.js",
    corePath: "/vendor/ocr/tesseract-core",
    langPath: "/vendor/ocr/tessdata/eng/4.0.0_best_int",
    workerBlobURL: false,
  },
];
const OCR_FAST_PROFILES = OCR_PROFILES.slice(0, 2);
const OCR_DEEP_PROFILE = OCR_PROFILES[2] || null;
const TESSERACT_SCRIPT_CANDIDATES = [
  "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
  "/vendor/ocr/tesseract.min.js",
];

let ocrWorker = null;
let ocrWorkerInitPromise = null;
let workerProgressSink = null;
let workerProgressValue = 0;
let tesseractRuntimePromise = null;
const profilePreflightCache = new Map();
const ocrLog = createLogger("ocr");

export async function runOcrOnFile(file, { onProgress } = {}) {
  if (!file?.type?.startsWith("image/")) {
    throw new Error("Please upload an image file.");
  }
  ocrLog.info("run_ocr.start", {
    fileName: file?.name || null,
    fileType: file?.type || null,
    fileSize: Number(file?.size || 0),
  });
  if (typeof window === "undefined") {
    throw new Error("OCR is only available in the browser runtime.");
  }
  await ensureTesseractRuntime();

  const image = await loadImageFromFile(file);
  const prepared = preprocessImageForOcr(image);
  const canvas = prepared.primaryCanvas;
  const runStartedAt = nowMs();

  workerProgressSink = onProgress || null;
  workerProgressValue = 0;

  try {
    let firstPassResult = null;
    try {
      firstPassResult = await withTimeout(
        recognizeWithOneShotFallback(canvas, {
          passLabel: prepared.primaryLabel,
          profiles: OCR_FAST_PROFILES,
          attemptTimeoutMs: OCR_FAST_PROFILE_ATTEMPT_TIMEOUT_MS,
        }),
        OCR_TOTAL_TIMEOUT_MS,
        "OCR timed out. Try a tighter crop (single row/card), then run OCR again."
      );
    } catch (fastPassError) {
      ocrLog.warn("run_ocr.fast_primary_failed", {
        message: String(fastPassError?.message || fastPassError),
      });
      firstPassResult = await withTimeout(
        recognizeWithOneShotFallback(canvas, {
          passLabel: `${prepared.primaryLabel}-rescue`,
          profiles: OCR_PROFILES,
          attemptTimeoutMs: OCR_DEEP_PROFILE_ATTEMPT_TIMEOUT_MS,
        }),
        OCR_TOTAL_TIMEOUT_MS,
        "OCR timed out during rescue pass. Try a tighter crop (single row/card), then run OCR again."
      );
    }

    let finalResult = firstPassResult;
    let finalCanvas = canvas;
    let finalPassLabel = prepared.primaryLabel;
    let finalQuality = evaluateOcrResultQuality(firstPassResult);
    ocrLog.info("run_ocr.oneshot_success", { ...finalQuality, pass: finalPassLabel });

    const hasBudgetForRetry = hasLatencyBudgetRemaining(runStartedAt, 2500);
    const shouldRetry =
      hasBudgetForRetry &&
      prepared.fallbackCanvas &&
      prepared.fallbackCanvas !== prepared.primaryCanvas &&
      (finalQuality.quality < OCR_RETRY_QUALITY_THRESHOLD ||
        finalQuality.confidence < 45 ||
        finalQuality.textLength < 18 ||
        finalQuality.noiseRatio > 0.2);
    if (!hasBudgetForRetry && finalQuality.quality < OCR_RETRY_QUALITY_THRESHOLD) {
      ocrLog.debug("run_ocr.retry_skipped_budget", {
        elapsedMs: Math.round(elapsedMs(runStartedAt)),
        budgetMs: OCR_LATENCY_BUDGET_MS,
      });
    }

    if (shouldRetry) {
      ocrLog.info("run_ocr.retry_preprocessed_pass", {
        reason: "low_quality_first_pass",
        quality: finalQuality.quality,
        confidence: finalQuality.confidence,
        textLength: finalQuality.textLength,
        noiseRatio: finalQuality.noiseRatio,
        fallbackLabel: prepared.fallbackLabel,
      });

      const retryResult = await withTimeout(
        recognizeWithOneShotFallback(prepared.fallbackCanvas, {
          passLabel: prepared.fallbackLabel,
          profiles: OCR_FAST_PROFILES,
          attemptTimeoutMs: OCR_FAST_PROFILE_ATTEMPT_TIMEOUT_MS,
        }),
        OCR_TOTAL_TIMEOUT_MS,
        "OCR retry timed out. Try a tighter crop (single row/card), then run OCR again."
      );
      const retryQuality = evaluateOcrResultQuality(retryResult);
      ocrLog.info("run_ocr.retry_result", retryQuality);

      if (retryQuality.quality > finalQuality.quality + 3) {
        finalResult = retryResult;
        finalCanvas = prepared.fallbackCanvas;
        finalPassLabel = prepared.fallbackLabel;
        finalQuality = retryQuality;
        ocrLog.info("run_ocr.retry_selected", {
          selectedPass: prepared.fallbackLabel,
          quality: finalQuality.quality,
        });
      } else {
        ocrLog.info("run_ocr.retry_discarded", {
          selectedPass: prepared.primaryLabel,
          quality: finalQuality.quality,
        });
      }
    }

    const hasDeskewBudget = hasLatencyBudgetRemaining(runStartedAt, 3200);
    const shouldDeskewRetry =
      hasDeskewBudget &&
      (finalQuality.quality < OCR_RETRY_QUALITY_THRESHOLD ||
        finalQuality.confidence < 48 ||
        finalQuality.noiseRatio > 0.22);
    if (!hasDeskewBudget && finalQuality.quality < OCR_RETRY_QUALITY_THRESHOLD) {
      ocrLog.debug("run_ocr.deskew_retry_skipped_budget", {
        elapsedMs: Math.round(elapsedMs(runStartedAt)),
        budgetMs: OCR_LATENCY_BUDGET_MS,
      });
    }

    if (shouldDeskewRetry) {
      const deskewSource = finalCanvas || prepared.primaryCanvas;
      const deskewAngle = estimateDeskewAngleFromCanvas(deskewSource, {
        maxAbsAngleDeg: OCR_DESKEW_MAX_ABS_ANGLE_DEG,
        stepDeg: OCR_DESKEW_STEP_DEG,
      });

      if (Math.abs(deskewAngle) >= OCR_DESKEW_MIN_ABS_ANGLE_DEG) {
        const deskewCanvas = rotateCanvas(deskewSource, -deskewAngle);
        ocrLog.info("run_ocr.deskew_retry_start", {
          angleDeg: Number(deskewAngle.toFixed(2)),
          sourceWidth: deskewSource.width,
          sourceHeight: deskewSource.height,
          deskewWidth: deskewCanvas.width,
          deskewHeight: deskewCanvas.height,
        });

        const deskewResult = await withTimeout(
          recognizeWithOneShotFallback(deskewCanvas, {
            passLabel: `deskew-${Number(deskewAngle.toFixed(2))}`,
            profiles: OCR_FAST_PROFILES,
            attemptTimeoutMs: OCR_FAST_PROFILE_ATTEMPT_TIMEOUT_MS,
          }),
          OCR_TOTAL_TIMEOUT_MS,
          "OCR deskew retry timed out. Try a tighter crop (single row/card), then run OCR again."
        );
        const deskewQuality = evaluateOcrResultQuality(deskewResult);
        ocrLog.info("run_ocr.deskew_retry_result", deskewQuality);

        if (deskewQuality.quality > finalQuality.quality + 2) {
          finalResult = deskewResult;
          finalCanvas = deskewCanvas;
          finalPassLabel = `deskew-${Number(deskewAngle.toFixed(2))}`;
          finalQuality = deskewQuality;
          ocrLog.info("run_ocr.deskew_retry_selected", {
            angleDeg: Number(deskewAngle.toFixed(2)),
            quality: finalQuality.quality,
          });
        } else {
          ocrLog.info("run_ocr.deskew_retry_discarded", {
            angleDeg: Number(deskewAngle.toFixed(2)),
            quality: finalQuality.quality,
          });
        }
      } else {
        ocrLog.debug("run_ocr.deskew_retry_skipped_low_angle", {
          angleDeg: Number(deskewAngle.toFixed(2)),
        });
      }
    }

    const shouldDeepRescue =
      Boolean(OCR_DEEP_PROFILE) &&
      hasLatencyBudgetRemaining(runStartedAt, 1000) &&
      (finalQuality.quality < OCR_DEEP_RESCUE_QUALITY_THRESHOLD ||
        finalQuality.textLength < OCR_DEEP_RESCUE_MIN_TEXT_LENGTH);
    if (shouldDeepRescue) {
      const rescueSource = finalCanvas || prepared.primaryCanvas;
      ocrLog.info("run_ocr.deep_rescue_start", {
        pass: finalPassLabel,
        quality: finalQuality.quality,
        textLength: finalQuality.textLength,
      });
      const rescueResult = await withTimeout(
        recognizeWithOneShotFallback(rescueSource, {
          passLabel: `${finalPassLabel}-best-int`,
          profiles: [OCR_DEEP_PROFILE],
          attemptTimeoutMs: OCR_DEEP_PROFILE_ATTEMPT_TIMEOUT_MS,
        }),
        OCR_TOTAL_TIMEOUT_MS,
        "OCR deep rescue timed out. Try a tighter crop (single row/card), then run OCR again."
      );
      const rescueQuality = evaluateOcrResultQuality(rescueResult);
      ocrLog.info("run_ocr.deep_rescue_result", rescueQuality);
      if (rescueQuality.quality > finalQuality.quality + 1) {
        finalResult = rescueResult;
        finalQuality = rescueQuality;
        finalPassLabel = `${finalPassLabel}-best-int`;
        ocrLog.info("run_ocr.deep_rescue_selected", {
          quality: finalQuality.quality,
        });
      } else {
        ocrLog.info("run_ocr.deep_rescue_discarded", {
          quality: finalQuality.quality,
        });
      }
    }

    ocrLog.info("run_ocr.final_quality", {
      ...finalQuality,
      pass: finalPassLabel,
      elapsedMs: Math.round(elapsedMs(runStartedAt)),
    });
    workerProgressSink?.("ocr complete", 1);
    return buildOcrOutput(finalResult);
  } catch (error) {
    if (looksLikeWorkerFault(error)) {
      ocrLog.warn("run_ocr.reset_worker_after_fault");
      await resetOcrWorker();
    }
    ocrLog.error("run_ocr.failed", { message: String(error?.message || error) });
    throw error;
  } finally {
    workerProgressSink = null;
    ocrLog.info("run_ocr.end");
  }
}

async function ensureTesseractRuntime() {
  if (window.Tesseract?.createWorker) {
    ocrLog.debug("runtime.ready_existing");
    return window.Tesseract;
  }
  if (tesseractRuntimePromise) {
    ocrLog.debug("runtime.await_existing_promise");
    return tesseractRuntimePromise;
  }

  tesseractRuntimePromise = (async () => {
    const failures = [];
    for (const scriptUrl of TESSERACT_SCRIPT_CANDIDATES) {
      try {
        ocrLog.info("runtime.load_script_attempt", { scriptUrl });
        await loadScriptOnce(scriptUrl);
        if (window.Tesseract?.createWorker) {
          ocrLog.info("runtime.load_script_success", { scriptUrl });
          return window.Tesseract;
        }
      } catch (error) {
        ocrLog.warn("runtime.load_script_failed", {
          scriptUrl,
          message: String(error?.message || error),
        });
        failures.push(`${scriptUrl}: ${String(error?.message || error)}`);
      }
    }
    ocrLog.error("runtime.load_all_failed", { failures });
    throw new Error(
      `Could not load Tesseract runtime from browser/CDN or local fallback. ${failures.join(" | ")}`
    );
  })().finally(() => {
    tesseractRuntimePromise = null;
  });

  return tesseractRuntimePromise;
}

async function loadScriptOnce(src) {
  if (!src) {
    throw new Error("Script URL is empty.");
  }

  const existing = Array.from(document.querySelectorAll("script[src]")).find(
    (script) => script.getAttribute("src") === src
  );
  if (existing && window.Tesseract?.createWorker) {
    return;
  }

  await withTimeout(
    new Promise((resolve, reject) => {
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error(`Failed loading ${src}`)), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.defer = true;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed loading ${src}`));
      document.head.appendChild(script);
    }),
    OCR_SCRIPT_LOAD_TIMEOUT_MS,
    `Timed out loading script: ${src}`
  );
}

async function recognizeWithOneShotFallback(
  canvas,
  { passLabel = "primary", profiles = OCR_PROFILES, attemptTimeoutMs = OCR_ONESHOT_ATTEMPT_TIMEOUT_MS } = {}
) {
  const failures = [];
  for (const profile of profiles) {
    try {
      await ensureProfilePreflight(profile);
      ocrLog.info("oneshot.attempt", { profile: profile.name, pass: passLabel });
      const result = await withTimeout(
        window.Tesseract.recognize(canvas, OCR_PRIMARY_LANG, {
          workerPath: profile.workerPath,
          corePath: profile.corePath,
          langPath: profile.langPath,
          workerBlobURL: profile.workerBlobURL,
          gzip: true,
          logger: handleWorkerLogger,
        }),
        attemptTimeoutMs,
        `OCR one-shot attempt timed out (${profile.name}, ${passLabel}, ${attemptTimeoutMs}ms).`
      );
      ocrLog.info("oneshot.success", { profile: profile.name, pass: passLabel });
      return result;
    } catch (error) {
      ocrLog.warn("oneshot.failed", {
        profile: profile.name,
        pass: passLabel,
        message: String(error?.message || error),
      });
      failures.push(`${profile.name}: ${String(error?.message || error)}`);
    }
  }
  ocrLog.error("oneshot.all_failed", { failures });
  throw new Error(failures.slice(0, 3).join(" | "));
}

function buildOcrOutput(result) {
  const text = String(result?.data?.text || "").trim();
  const lines = normalizeOcrLines(result?.data?.lines || []);
  const words = normalizeOcrWords(result?.data?.words || []);
  return {
    text,
    ocrArtifacts: {
      text,
      lines,
      words,
    },
  };
}

async function ensureOcrWorker() {
  if (ocrWorker) {
    ocrLog.debug("worker.ready_existing");
    return ocrWorker;
  }
  if (ocrWorkerInitPromise) {
    ocrLog.debug("worker.await_existing_promise");
    return ocrWorkerInitPromise;
  }

  ocrWorkerInitPromise = withTimeout(
    initializeWorkerWithFallback(),
    OCR_WORKER_INIT_TIMEOUT_MS,
    "OCR timed out while initializing language data. Verify local assets under /node_modules and restart server."
  )
    .then((worker) => {
      ocrWorker = worker;
      ocrLog.info("worker.ready");
      return worker;
    })
    .finally(() => {
      ocrWorkerInitPromise = null;
    });

  return ocrWorkerInitPromise;
}

async function initializeWorkerWithFallback() {
  const failures = [];
  for (const profile of OCR_PROFILES) {
    try {
      await ensureProfilePreflight(profile);
      ocrLog.info("worker.init_attempt", { profile: profile.name });
      const worker = await withTimeout(
        tryCreateWorker(profile),
        OCR_WORKER_ATTEMPT_TIMEOUT_MS,
        `OCR worker init attempt timed out (${profile.name}).`
      );
      ocrLog.info("worker.init_success", { profile: profile.name });
      return worker;
    } catch (error) {
      ocrLog.warn("worker.init_failed", {
        profile: profile.name,
        message: String(error?.message || error),
      });
      failures.push(`${profile.name}: ${String(error?.message || error)}`);
      await resetOcrWorker();
    }
  }

  ocrLog.error("worker.init_all_failed", { failures });
  throw new Error(
    `Could not initialize OCR worker. ${failures.slice(0, 3).join(" | ")}`
  );
}

async function tryCreateWorker(profile) {
  const tesseract = window.Tesseract;
  if (!tesseract?.createWorker) {
    throw new Error("Tesseract createWorker API is unavailable.");
  }

  ocrLog.debug("worker.create", {
    profile: profile.name,
    workerPath: profile.workerPath,
    corePath: profile.corePath,
    langPath: profile.langPath,
  });
  const worker = await tesseract.createWorker(OCR_PRIMARY_LANG, 1, {
    workerPath: profile.workerPath,
    corePath: profile.corePath,
    langPath: profile.langPath,
    workerBlobURL: profile.workerBlobURL,
    gzip: true,
    logger: handleWorkerLogger,
    errorHandler: (error) => {
      ocrLog.error("worker.error_handler", { profile: profile.name, message: String(error?.message || error) });
      console.error("Tesseract worker error:", error);
    },
  });

  await worker.setParameters({
    tessedit_pageseg_mode: "6",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  ocrLog.debug("worker.create_done", { profile: profile.name });

  return worker;
}

async function ensureProfilePreflight(profile) {
  if (!profile?.name) {
    return;
  }
  const existing = profilePreflightCache.get(profile.name);
  if (existing) {
    return existing;
  }
  const promise = preflightProfile(profile).catch((error) => {
    profilePreflightCache.delete(profile.name);
    throw error;
  });
  profilePreflightCache.set(profile.name, promise);
  return promise;
}

async function preflightProfile(profile) {
  const workerUrl = resolveAbsoluteUrl(profile.workerPath);
  const langUrl = resolveAbsoluteUrl(`${String(profile.langPath || "").replace(/\/+$/, "")}/${OCR_PRIMARY_LANG}.traineddata.gz`);
  const coreCandidates = buildCoreProbeUrls(profile.corePath).map((url) => resolveAbsoluteUrl(url));

  ocrLog.info("profile.preflight.start", {
    profile: profile.name,
    workerUrl,
    coreCandidates,
    langUrl,
  });

  const workerProbe = await probeUrl(workerUrl);
  if (!workerProbe.ok) {
    ocrLog.warn("profile.preflight.worker_unreachable", {
      profile: profile.name,
      reason: workerProbe.reason,
    });
    throw new Error(`worker script not reachable (${workerProbe.reason})`);
  }

  let coreReachable = false;
  const coreProbeFailures = [];
  for (const coreUrl of coreCandidates) {
    const probe = await probeUrl(coreUrl);
    if (probe.ok) {
      coreReachable = true;
      break;
    }
    coreProbeFailures.push(`${coreUrl} => ${probe.reason}`);
  }
  if (!coreReachable) {
    ocrLog.warn("profile.preflight.core_unreachable", {
      profile: profile.name,
      failures: coreProbeFailures,
    });
    throw new Error(`core wasm-js not reachable (${coreProbeFailures[0] || "no core candidates"})`);
  }

  const langProbe = await probeUrl(langUrl);
  if (!langProbe.ok) {
    ocrLog.warn("profile.preflight.lang_unreachable", {
      profile: profile.name,
      reason: langProbe.reason,
    });
    throw new Error(`language data not reachable (${langProbe.reason})`);
  }

  ocrLog.info("profile.preflight.success", { profile: profile.name });
}

function buildCoreProbeUrls(corePath) {
  const base = String(corePath || "").replace(/\/+$/, "");
  if (!base) {
    return [];
  }
  if (base.endsWith(".js")) {
    return [base];
  }
  return [
    `${base}/tesseract-core-simd-lstm.wasm.js`,
    `${base}/tesseract-core-lstm.wasm.js`,
    `${base}/tesseract-core-simd.wasm.js`,
    `${base}/tesseract-core.wasm.js`,
  ];
}

function resolveAbsoluteUrl(value) {
  return new URL(String(value || ""), window.location.href).toString();
}

async function probeUrl(url) {
  try {
    const headResponse = await fetchWithTimeout(
      url,
      buildProbeRequestInit(url, "HEAD"),
      OCR_PROFILE_PREFLIGHT_TIMEOUT_MS
    );
    if (headResponse.ok) {
      return { ok: true };
    }

    const getResponse = await fetchWithTimeout(
      url,
      buildProbeRequestInit(url, "GET"),
      OCR_PROFILE_PREFLIGHT_TIMEOUT_MS
    );
    if (!getResponse.ok) {
      return { ok: false, reason: `HTTP ${getResponse.status}` };
    }
    try {
      await getResponse.body?.cancel?.();
    } catch {
      // Best effort to stop downloading large assets after reachability check.
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
}

function buildProbeRequestInit(url, method) {
  const target = new URL(url, window.location.href);
  const sameOrigin = target.origin === window.location.origin;
  return {
    method,
    cache: "no-store",
    credentials: sameOrigin ? "same-origin" : "omit",
    mode: sameOrigin ? "same-origin" : "cors",
    redirect: "follow",
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function handleWorkerLogger(message) {
  if (!message?.status) {
    return;
  }
  const next = deriveOcrProgress(message.status, message.progress, workerProgressValue);
  workerProgressValue = Math.max(workerProgressValue, next);
  workerProgressSink?.(message.status, workerProgressValue);
}

function looksLikeWorkerFault(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("failed to fetch") ||
    message.includes("worker") ||
    message.includes("wasm")
  );
}

async function resetOcrWorker() {
  if (!ocrWorker) {
    return;
  }
  ocrLog.warn("worker.terminate");
  try {
    await ocrWorker.terminate();
  } catch {
    // Ignore worker terminate failures.
  } finally {
    ocrWorker = null;
    ocrLog.debug("worker.terminated");
  }
}

export function formatTesseractStatus(status, progress) {
  const cleanStatus = String(status || "").trim() || "processing ocr";
  const pct = Math.round((progress || 0) * 100);
  return `${cleanStatus.replace(/\b\w/g, (c) => c.toUpperCase())} (${pct}%)`;
}

export function deriveOcrProgress(status, rawProgress, previousProgress = 0) {
  const previous = clamp01(previousProgress);
  const hinted = deriveProgressFromStatusHint(status);
  const stageCap = deriveProgressStageCap(status);
  const explicit = Number.isFinite(rawProgress) ? clamp01(rawProgress) : null;
  if (explicit !== null) {
    const cappedExplicit = stageCap !== null ? Math.min(explicit, stageCap) : explicit;
    if (cappedExplicit <= 0 && hinted !== null) {
      return Math.max(previous, hinted);
    }
    return Math.max(previous, cappedExplicit);
  }

  if (hinted !== null) {
    return Math.max(previous, hinted);
  }
  return previous;
}

export function deriveProgressFromStatusHint(status) {
  const key = String(status || "").trim().toLowerCase();
  if (!key) {
    return null;
  }
  if (key.includes("initializing tesseract")) return 0.04;
  if (key.includes("loading tesseract core")) return 0.1;
  if (key.includes("loaded tesseract core")) return 0.18;
  if (key.includes("initializing api")) return 0.26;
  if (key.includes("initialized api")) return 0.34;
  if (key.includes("loading language")) return 0.45;
  if (key.includes("loaded language")) return 0.6;
  if (key.includes("recognizing text")) return 0.7;
  if (key.includes("ocr complete")) return 1;
  return null;
}

function deriveProgressStageCap(status) {
  const key = String(status || "").trim().toLowerCase();
  if (!key) {
    return null;
  }
  if (key.includes("initializing tesseract")) return 0.12;
  if (key.includes("loading tesseract core")) return 0.22;
  if (key.includes("loaded tesseract core")) return 0.3;
  if (key.includes("initializing api")) return 0.4;
  if (key.includes("initialized api")) return 0.5;
  if (key.includes("loading language")) return 0.72;
  if (key.includes("loaded language")) return 0.82;
  if (key.includes("recognizing text")) return 1;
  if (key.includes("ocr complete")) return 1;
  return null;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image file."));
    };
    image.src = url;
  });
}

function preprocessImageForOcr(image) {
  const baseCanvas = renderImageToCanvas(image, { minTarget: 1100, maxTarget: 2200 });
  const { width, height } = baseCanvas;
  const ctx = baseCanvas.getContext("2d", { willReadFrequently: true });
  const imgData = ctx.getImageData(0, 0, width, height);
  const gray = rgbToGrayscale(imgData.data);
  const stretched = stretchGrayscaleContrast(gray);
  const otsu = computeOtsuThreshold(stretched);
  const binary = despeckleBinary(
    binarizeGrayscale(stretched, otsu),
    width,
    height
  );

  const bounds = detectInkBounds(binary, width, height);
  const useCrop = shouldCropBounds(bounds, width, height);
  const grayCanvas = grayscaleToCanvas(stretched, width, height);
  const binaryCanvas = grayscaleToCanvas(binary, width, height);
  const primaryCanvas = useCrop ? cropCanvas(grayCanvas, bounds, 18) : grayCanvas;
  const fallbackCanvas = useCrop ? cropCanvas(binaryCanvas, bounds, 18) : binaryCanvas;

  ocrLog.info("preprocess.done", {
    width,
    height,
    otsuThreshold: otsu,
    cropped: useCrop,
    cropWidth: useCrop ? primaryCanvas.width : width,
    cropHeight: useCrop ? primaryCanvas.height : height,
  });

  return {
    primaryCanvas,
    fallbackCanvas,
    primaryLabel: useCrop ? "enhanced-gray-cropped" : "enhanced-gray",
    fallbackLabel: useCrop ? "binary-otsu-cropped" : "binary-otsu",
  };
}

function renderImageToCanvas(image, { minTarget, maxTarget }) {
  const maxDimension = Math.max(image.width, image.height);
  let scale = 1;
  if (maxDimension > maxTarget) {
    scale = maxTarget / maxDimension;
  } else if (maxDimension < minTarget) {
    scale = Math.min(2.2, minTarget / maxDimension);
  }

  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return canvas;
}

function rgbToGrayscale(rgba) {
  const out = new Uint8ClampedArray(Math.floor(rgba.length / 4));
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 1) {
    out[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return out;
}

function stretchGrayscaleContrast(gray) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) {
    histogram[gray[i]] += 1;
  }
  const low = percentileFromHistogram(histogram, gray.length, 0.02);
  const high = percentileFromHistogram(histogram, gray.length, 0.98);
  if (high <= low + 1) {
    return gray;
  }

  const out = new Uint8ClampedArray(gray.length);
  const scale = 255 / (high - low);
  for (let i = 0; i < gray.length; i += 1) {
    const v = (gray[i] - low) * scale;
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  }
  return out;
}

function percentileFromHistogram(histogram, total, p) {
  const threshold = Math.max(0, Math.min(total, Math.floor(total * p)));
  let acc = 0;
  for (let i = 0; i < histogram.length; i += 1) {
    acc += histogram[i];
    if (acc >= threshold) {
      return i;
    }
  }
  return histogram.length - 1;
}

function computeOtsuThreshold(gray) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) {
    histogram[gray[i]] += 1;
  }

  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) {
    sum += i * histogram[i];
  }

  let sumB = 0;
  let wB = 0;
  let maxVariance = -1;
  let threshold = 128;

  for (let t = 0; t < 256; t += 1) {
    wB += histogram[t];
    if (wB === 0) {
      continue;
    }
    const wF = total - wB;
    if (wF === 0) {
      break;
    }
    sumB += t * histogram[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }
  return threshold;
}

function binarizeGrayscale(gray, threshold) {
  const out = new Uint8ClampedArray(gray.length);
  for (let i = 0; i < gray.length; i += 1) {
    out[i] = gray[i] <= threshold ? 0 : 255;
  }
  return out;
}

function despeckleBinary(binary, width, height) {
  const out = new Uint8ClampedArray(binary);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const isBlack = binary[idx] === 0;
      let blackNeighbors = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nIdx = (y + dy) * width + (x + dx);
          if (binary[nIdx] === 0) {
            blackNeighbors += 1;
          }
        }
      }

      if (isBlack && blackNeighbors <= 1) {
        out[idx] = 255;
      } else if (!isBlack && blackNeighbors >= 7) {
        out[idx] = 0;
      }
    }
  }
  return out;
}

function detectInkBounds(binary, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  let inkCount = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (binary[idx] !== 0) {
        continue;
      }
      inkCount += 1;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }

  if (x1 < x0 || y1 < y0 || inkCount === 0) {
    return null;
  }

  return { x0, y0, x1, y1, inkCount };
}

function shouldCropBounds(bounds, width, height) {
  if (!bounds) {
    return false;
  }
  const bboxWidth = bounds.x1 - bounds.x0 + 1;
  const bboxHeight = bounds.y1 - bounds.y0 + 1;
  const areaRatio = (bboxWidth * bboxHeight) / Math.max(1, width * height);
  const inkRatio = bounds.inkCount / Math.max(1, width * height);
  if (inkRatio < 0.002) {
    return false;
  }
  if (bboxWidth < width * 0.2 || bboxHeight < height * 0.12) {
    return false;
  }
  return areaRatio < 0.94;
}

function cropCanvas(canvas, bounds, padding = 12) {
  const x0 = Math.max(0, bounds.x0 - padding);
  const y0 = Math.max(0, bounds.y0 - padding);
  const x1 = Math.min(canvas.width - 1, bounds.x1 + padding);
  const y1 = Math.min(canvas.height - 1, bounds.y1 + padding);
  const width = Math.max(1, x1 - x0 + 1);
  const height = Math.max(1, y1 - y0 + 1);

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, x0, y0, width, height, 0, 0, width, height);
  return out;
}

function grayscaleToCanvas(gray, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;
  for (let i = 0, j = 0; i < data.length; i += 4, j += 1) {
    const v = gray[j];
    data[i] = v;
    data[i + 1] = v;
    data[i + 2] = v;
    data[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function estimateDeskewAngleFromCanvas(
  canvas,
  { maxAbsAngleDeg = OCR_DESKEW_MAX_ABS_ANGLE_DEG, stepDeg = OCR_DESKEW_STEP_DEG, maxSampleDimension = 700 } = {}
) {
  if (!canvas || canvas.width < 10 || canvas.height < 10) {
    return 0;
  }

  const sampleCanvas = downsampleCanvas(canvas, maxSampleDimension);
  const width = sampleCanvas.width;
  const height = sampleCanvas.height;
  const ctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
  const imgData = ctx.getImageData(0, 0, width, height);
  const gray = stretchGrayscaleContrast(rgbToGrayscale(imgData.data));
  const threshold = computeOtsuThreshold(gray);
  const binary = binarizeGrayscale(gray, threshold);

  const area = width * height;
  const samplingStride = Math.max(1, Math.floor(area / 28_000));
  const points = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      if (binary[idx] !== 0) {
        continue;
      }
      if (((x + y * 3) % samplingStride) !== 0) {
        continue;
      }
      points.push({ x, y });
    }
  }

  if (points.length < 220) {
    return 0;
  }

  let baselineScore = 0;
  let bestScore = -1;
  let bestAngle = 0;
  const binsLength = Math.max(512, height * 3 + 4);
  const offset = height;

  for (let angleDeg = -maxAbsAngleDeg; angleDeg <= maxAbsAngleDeg + 0.0001; angleDeg += stepDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    const sin = Math.sin(rad);
    const cos = Math.cos(rad);
    const bins = new Uint16Array(binsLength);

    for (const p of points) {
      const yRot = p.y * cos - p.x * sin;
      const bucket = Math.round(yRot + offset);
      if (bucket < 0 || bucket >= bins.length) {
        continue;
      }
      bins[bucket] += 1;
    }

    let score = 0;
    for (let i = 0; i < bins.length; i += 1) {
      const v = bins[i];
      score += v * v;
    }

    if (Math.abs(angleDeg) < stepDeg / 2) {
      baselineScore = score;
    }
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angleDeg;
    }
  }

  if (!Number.isFinite(bestScore) || bestScore <= 0 || !Number.isFinite(baselineScore) || baselineScore <= 0) {
    return 0;
  }

  const gain = bestScore / baselineScore;
  if (gain < 1.03) {
    return 0;
  }

  return Number(bestAngle.toFixed(2));
}

function downsampleCanvas(canvas, maxDimension) {
  const width = Number(canvas?.width || 0);
  const height = Number(canvas?.height || 0);
  if (!width || !height) {
    return canvas;
  }
  const maxSide = Math.max(width, height);
  if (maxSide <= maxDimension) {
    return canvas;
  }

  const scale = maxDimension / maxSide;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width * scale));
  out.height = Math.max(1, Math.round(height * scale));
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

function rotateCanvas(sourceCanvas, angleDeg) {
  const width = Number(sourceCanvas?.width || 0);
  const height = Number(sourceCanvas?.height || 0);
  if (!width || !height || !Number.isFinite(angleDeg)) {
    return sourceCanvas;
  }

  const rad = (angleDeg * Math.PI) / 180;
  const absSin = Math.abs(Math.sin(rad));
  const absCos = Math.abs(Math.cos(rad));
  const outWidth = Math.max(1, Math.ceil(width * absCos + height * absSin));
  const outHeight = Math.max(1, Math.ceil(width * absSin + height * absCos));

  const out = document.createElement("canvas");
  out.width = outWidth;
  out.height = outHeight;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, outWidth, outHeight);
  ctx.translate(outWidth / 2, outHeight / 2);
  ctx.rotate(rad);
  ctx.drawImage(sourceCanvas, -width / 2, -height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

function evaluateOcrResultQuality(result) {
  const text = String(result?.data?.text || "").trim();
  const textLength = text.length;
  const lineCount = Array.isArray(result?.data?.lines) ? result.data.lines.length : 0;
  const confidence = Number.isFinite(result?.data?.confidence) ? Number(result.data.confidence) : 0;
  const alphaNum = (text.match(/[A-Za-z0-9]/g) || []).length;
  const noisyChars = (text.match(/[^A-Za-z0-9\s:.,\/\-()]/g) || []).length;
  const noiseRatio = noisyChars / Math.max(1, text.length);
  const signalDensity = alphaNum / Math.max(1, text.length);
  const quality =
    confidence * 0.55 +
    Math.min(30, alphaNum * 0.35) +
    Math.min(10, lineCount * 1.1) +
    signalDensity * 10 -
    Math.min(18, noisyChars * 0.9);

  return {
    quality: Number(quality.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    textLength,
    lineCount,
    noiseRatio: Number(noiseRatio.toFixed(3)),
  };
}

function normalizeOcrLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((line) => ({
      text: String(line?.text || "").trim(),
      confidence: Number.isFinite(line?.confidence) ? Number(line.confidence) : 0,
      bbox: normalizeBbox(line?.bbox),
    }))
    .filter((line) => line.text);
}

function normalizeOcrWords(words) {
  return (Array.isArray(words) ? words : [])
    .map((word) => ({
      text: String(word?.text || "").trim(),
      confidence: Number.isFinite(word?.confidence) ? Number(word.confidence) : 0,
      bbox: normalizeBbox(word?.bbox),
    }))
    .filter((word) => word.text);
}

function normalizeBbox(bbox) {
  if (!bbox || typeof bbox !== "object") {
    return null;
  }

  const x0 = toFiniteNumber(bbox.x0);
  const y0 = toFiniteNumber(bbox.y0);
  const x1 = toFiniteNumber(bbox.x1);
  const y1 = toFiniteNumber(bbox.y1);
  if ([x0, y0, x1, y1].some((n) => !Number.isFinite(n))) {
    return null;
  }

  return { x0, y0, x1, y1 };
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function elapsedMs(startMs) {
  return Math.max(0, nowMs() - Number(startMs || 0));
}

function hasLatencyBudgetRemaining(startMs, reserveMs = 0) {
  return elapsedMs(startMs) < Math.max(500, OCR_LATENCY_BUDGET_MS - reserveMs);
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.max(0, Math.min(1, n));
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId = null;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(timeoutMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
