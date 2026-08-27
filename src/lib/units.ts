import type { ReportDefinition } from './api';
import { DEFAULT_UNIT_LIMIT, type ReportUnit, type SiteConfig } from './settings';

export type ResolvedUnit = {
  unit: ReportUnit;
  report: ReportDefinition;
  label: string;
};

export function defaultUnits(catalog: ReportDefinition[]): ReportUnit[] {
  return catalog.map((report) => ({
    id: `default-${report.id}`,
    reportId: report.id,
    label: '',
    threshold: null,
    limit: DEFAULT_UNIT_LIMIT,
  }));
}

export function resolveUnits(site: SiteConfig, catalog: ReportDefinition[]): ResolvedUnit[] {
  const units = site.units.length > 0 ? site.units : defaultUnits(catalog);
  return units.flatMap((unit) => {
    const report = catalog.find((candidate) => candidate.id === unit.reportId);
    return report ? [{ unit, report, label: unit.label || report.name }] : [];
  });
}
