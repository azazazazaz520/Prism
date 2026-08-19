import type { OcrResult as PaddleResult } from '@paddleocr/paddleocr-js';
import type { OcrLine, OcrResult } from '../types';

const LOW_CONFIDENCE_THRESHOLD = 0.75;

interface NormalizedLine extends OcrLine {
  confidence: number;
  bounds: NonNullable<OcrLine['bounds']>;
}

function normalizeLine(item: PaddleResult['items'][number]): NormalizedLine {
  const xs = item.poly.map((point) => point[0]);
  const ys = item.poly.map((point) => point[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  return {
    text: item.text,
    confidence: item.score,
    bounds: {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
    },
  };
}

function compareLines(a: NormalizedLine, b: NormalizedLine): number {
  const rowTolerance = Math.max(a.bounds.height, b.bounds.height) * 0.5;
  const verticalDistance = Math.abs(a.bounds.y - b.bounds.y);
  if (verticalDistance > rowTolerance) return a.bounds.y - b.bounds.y;
  return a.bounds.x - b.bounds.x;
}

function weightedConfidence(lines: NormalizedLine[]): number | undefined {
  let weightedScore = 0;
  let totalWeight = 0;
  for (const line of lines) {
    const weight = Math.max(1, Array.from(line.text.trim()).length);
    weightedScore += line.confidence * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? weightedScore / totalWeight : undefined;
}

/** 将 SDK 结果转换为 Prism 稳定结果，不进行文字纠错。 */
export function normalizePaddleResult(result: PaddleResult, initializeMs?: number): OcrResult {
  const lines = result.items
    .map(normalizeLine)
    .filter((line) => line.text.trim().length > 0)
    .sort(compareLines);
  const lowConfidenceCount = lines.filter(
    (line) => line.confidence < LOW_CONFIDENCE_THRESHOLD,
  ).length;
  const warnings =
    lowConfidenceCount > 0 ? [`${lowConfidenceCount} 行文字置信度较低，请重点检查。`] : [];

  return {
    text: lines.map((line) => line.text).join('\n'),
    lines,
    language: 'zh-Hans,zh-Hant,en,ja',
    confidence: weightedConfidence(lines),
    provider: 'paddleocr-web',
    warnings,
    metrics: {
      ...(initializeMs === undefined ? {} : { initialize_ms: initializeMs }),
      detection_ms: result.metrics.detMs,
      recognition_ms: result.metrics.recMs,
      total_ms: result.metrics.totalMs,
      detected_boxes: result.metrics.detectedBoxes,
      recognized_lines: result.metrics.recognizedCount,
      runtime: `${result.runtime.detProvider}/${result.runtime.recProvider}`,
    },
  };
}
