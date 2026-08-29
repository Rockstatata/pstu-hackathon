"use client";

import type { ThroughputPoint } from "@/lib/types";
import { useI18n } from "@/components/i18n/LanguageProvider";

/**
 * Transfers per minute for the last hour, drawn from the sixty rows the API
 * returns. The series is gap-filled server-side, so an idle minute is a real
 * zero-height bar rather than a missing point the eye would join up into
 * traffic that never happened.
 *
 * Deliberately not a charting library: sixty bars and a baseline do not justify
 * a dependency, and the tokens have to resolve in both themes anyway. The bars
 * are brand purple because throughput is not a verdict — nothing here has
 * succeeded or failed, so nothing here is green or red.
 */
export function ThroughputChart({ points }: { points: ThroughputPoint[] }) {
  const { t, formatNumber } = useI18n();
  const peak = points.reduce((highest, point) => Math.max(highest, point.transfers), 0);
  const total = points.reduce((sum, point) => sum + point.transfers, 0);

  const SLOT = 4;
  const BAR = 3;
  const HEIGHT = 60;
  const width = points.length * SLOT;

  return (
    <figure className="mt-5">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={t(
          "Transfers per minute over the last hour. {total} in total, busiest minute {peak}.",
          { total: formatNumber(total), peak: formatNumber(peak) },
        )}
        className="h-24 w-full sm:h-28"
      >
        {points.map((point, index) => {
          // A minute with traffic never renders as nothing: one unit of height
          // is kept so a quiet minute is visibly different from an idle one.
          const height =
            point.transfers === 0
              ? 0
              : Math.max(1.5, (point.transfers / Math.max(peak, 1)) * HEIGHT);
          return (
            <rect
              key={point.minute}
              x={index * SLOT}
              y={HEIGHT - height}
              width={BAR}
              height={height}
              className="fill-primary"
            />
          );
        })}
      </svg>
      <div className="mt-2 flex items-center justify-between border-t border-divider pt-2 text-[12px] text-text-secondary">
        <span>{t("60 minutes ago")}</span>
        <span className="tnum">{t("Busiest minute: {peak}", { peak: formatNumber(peak) })}</span>
        <span>{t("Now")}</span>
      </div>
    </figure>
  );
}
