const MAINTENANCE_ROUTES = {
  "17 4 * * *": "/api/internal/retention",
  "7 * * * *": "/api/internal/invoices",
  "37 * * * *": "/api/internal/notifications",
} as const;

export function maintenanceRouteForCron(cron: string): string | null {
  return MAINTENANCE_ROUTES[cron as keyof typeof MAINTENANCE_ROUTES] ?? null;
}
