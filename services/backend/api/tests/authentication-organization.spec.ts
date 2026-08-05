import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  allowsSelfRegistration,
  resolveAuthenticationOrganization,
  type AuthenticationOrganizationDatabase,
} from '../src/auth/authentication-organization.js';

test('slug legado do aplicativo resolve a organização criada pelo bootstrap', async () => {
  const database = createDatabase({
    bootstrap: {
      initializedAt: new Date('2026-08-05T12:00:00Z'),
      organizationId: 'organization-installed',
    },
    organizations: [
      { id: 'organization-installed', slug: 'escola-data-master' },
      { id: 'organization-legacy', slug: 'professor-connect' },
    ],
  });

  assert.deepEqual(await resolveAuthenticationOrganization(database, 'professor-connect'), {
    id: 'organization-installed',
    slug: 'escola-data-master',
  });
});

test('cliente sem slug usa a organização instalada e slug explícito continua isolado', async () => {
  const database = createDatabase({
    bootstrap: {
      initializedAt: new Date('2026-08-05T12:00:00Z'),
      organizationId: 'organization-installed',
    },
    organizations: [
      { id: 'organization-installed', slug: 'escola-data-master' },
      { id: 'organization-other', slug: 'outra-instituicao' },
    ],
  });

  assert.deepEqual(await resolveAuthenticationOrganization(database), {
    id: 'organization-installed',
    slug: 'escola-data-master',
  });
  assert.deepEqual(await resolveAuthenticationOrganization(database, 'outra-instituicao'), {
    id: 'organization-other',
    slug: 'outra-instituicao',
  });
});

test('não autentica sem organização instalada e respeita a preferência de autocadastro', async () => {
  const database = createDatabase({ bootstrap: null, organizations: [] });

  assert.equal(await resolveAuthenticationOrganization(database), null);
  assert.equal(allowsSelfRegistration({ allowSelfRegistration: true }), true);
  assert.equal(allowsSelfRegistration({ allowSelfRegistration: false }), false);
  assert.equal(allowsSelfRegistration([]), false);
});

function createDatabase(input: {
  readonly bootstrap: {
    readonly initializedAt: Date;
    readonly organizationId: string;
  } | null;
  readonly organizations: readonly { readonly id: string; readonly slug: string }[];
}): AuthenticationOrganizationDatabase {
  return {
    bootstrapState: {
      findUnique: () => Promise.resolve(input.bootstrap),
    },
    organization: {
      findUnique: (arguments_: { where: { id?: string; slug?: string } }) =>
        Promise.resolve(
          input.organizations.find(
            (organization) =>
              organization.id === arguments_.where.id ||
              organization.slug === arguments_.where.slug,
          ) ?? null,
        ),
    },
  } as unknown as AuthenticationOrganizationDatabase;
}
