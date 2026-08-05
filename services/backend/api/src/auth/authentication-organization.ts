import type { Prisma } from '@professor-connect/database';

const LEGACY_DESKTOP_ORGANIZATION_SLUG = 'professor-connect';

export type AuthenticationOrganizationDatabase = Pick<
  Prisma.TransactionClient,
  'bootstrapState' | 'organization'
>;

export interface AuthenticationOrganization {
  readonly id: string;
  readonly slug: string;
}

export async function resolveAuthenticationOrganization(
  database: AuthenticationOrganizationDatabase,
  requestedSlug?: string,
): Promise<AuthenticationOrganization | null> {
  const normalizedSlug = requestedSlug?.trim().toLowerCase();

  if (normalizedSlug !== undefined && normalizedSlug !== LEGACY_DESKTOP_ORGANIZATION_SLUG) {
    return database.organization.findUnique({
      where: { slug: normalizedSlug },
      select: { id: true, slug: true },
    });
  }

  const bootstrapState = await database.bootstrapState.findUnique({
    where: { id: 1 },
    select: { initializedAt: true, organizationId: true },
  });
  if (
    bootstrapState !== null &&
    bootstrapState.initializedAt !== null &&
    bootstrapState.organizationId !== null
  ) {
    const installedOrganization = await database.organization.findUnique({
      where: { id: bootstrapState.organizationId },
      select: { id: true, slug: true },
    });
    if (installedOrganization !== null) return installedOrganization;
  }

  if (normalizedSlug === LEGACY_DESKTOP_ORGANIZATION_SLUG) {
    return database.organization.findUnique({
      where: { slug: LEGACY_DESKTOP_ORGANIZATION_SLUG },
      select: { id: true, slug: true },
    });
  }

  return null;
}

export function allowsSelfRegistration(defaults: Prisma.JsonValue): boolean {
  return (
    typeof defaults === 'object' &&
    defaults !== null &&
    !Array.isArray(defaults) &&
    defaults.allowSelfRegistration === true
  );
}
