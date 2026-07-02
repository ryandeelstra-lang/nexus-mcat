// Copyright: Ankitects Pty Ltd and contributors
// License: GNU AGPL, version 3 or later; http://www.gnu.org/licenses/agpl.html

// charged_up: defensive almanac parsing helpers — format engine values, never synthesize scores.
import type { DashboardCoverage, DashboardData, DashboardMetric } from "./rpc";

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asMetric(value: unknown): DashboardMetric | null {
    return isRecord(value) ? (value as DashboardMetric) : null;
}

export function asCoverage(value: unknown): DashboardCoverage | null {
    return isRecord(value) ? (value as DashboardCoverage) : null;
}

export function asNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asString(value: unknown): string | null {
    return typeof value === "string" ? value : null;
}

export function asRange(value: unknown): [number, number] | null {
    if (!Array.isArray(value) || value.length !== 2) {
        return null;
    }
    const lo = asNumber(value[0]);
    const hi = asNumber(value[1]);
    if (lo === null || hi === null) {
        return null;
    }
    return [lo, hi];
}

function visitTree(
    value: unknown,
    visit: (entry: { key: string | null; value: unknown }) => void,
    key: string | null = null,
): void {
    visit({ key, value });
    if (Array.isArray(value)) {
        for (const item of value) {
            visitTree(item, visit, null);
        }
        return;
    }
    if (!isRecord(value)) {
        return;
    }
    for (const [childKey, child] of Object.entries(value)) {
        visitTree(child, visit, childKey);
    }
}

export function hasSyntheticCaveat(payload: DashboardData | null): boolean {
    if (!payload) {
        return false;
    }
    let found = false;
    visitTree(payload, ({ key, value }) => {
        if (found) {
            return;
        }
        const normalizedKey = (key ?? "").toLowerCase();
        if (normalizedKey === "synthetic" && value === true) {
            found = true;
            return;
        }
        if (typeof value === "string") {
            const text = value.toLowerCase();
            if (
                normalizedKey.includes("data_provenance")
                || normalizedKey.includes("provenance")
                || normalizedKey.includes("synthetic")
            ) {
                if (text.includes("synthetic")) {
                    found = true;
                }
            }
        }
    });
    return found;
}

export function extractReviewCount(payload: DashboardData | null): number | null {
    if (!payload) {
        return null;
    }
    let found: number | null = null;
    visitTree(payload, ({ key, value }) => {
        if (found !== null || !key) {
            return;
        }
        const normalized = key.toLowerCase();
        if (
            normalized === "graded_reviews"
            || normalized === "review_count"
            || normalized === "reviews"
            || normalized === "n_reviews"
        ) {
            const numeric = asNumber(value);
            if (numeric !== null) {
                found = numeric;
            }
        }
    });
    return found;
}

export function extractProjectionLine(payload: DashboardData | null): string | null {
    if (!payload) {
        return null;
    }
    let bloomsPerWeek: number | null = null;
    visitTree(payload, ({ key, value }) => {
        if (bloomsPerWeek !== null || !key) {
            return;
        }
        const normalized = key.toLowerCase();
        const numeric = asNumber(value);
        if (numeric === null) {
            return;
        }
        if (
            normalized.includes("weekly_blooms")
            || normalized.includes("blooms_per_week")
            || normalized.includes("bloom_delta_7d")
            || normalized.includes("bloom_7d")
        ) {
            bloomsPerWeek = numeric;
        }
    });
    if (bloomsPerWeek === null) {
        return null;
    }
    const rounded = Math.round(bloomsPerWeek);
    const sign = rounded >= 0 ? "+" : "";
    return `On track: ${sign}${rounded} blooms this week`;
}
