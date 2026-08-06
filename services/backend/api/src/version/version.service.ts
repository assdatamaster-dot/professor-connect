import { Prisma, prismaClient } from '@professor-connect/database';

import type {
  PublishReleaseInput,
  UpdateEventInput,
  VersionApplication,
  VersionChannel,
  VersionCheckInput,
  VersionServiceContract,
} from './version.types.js';

export class VersionService implements VersionServiceContract {
  public async latest(application: VersionApplication, channel: VersionChannel): Promise<unknown> {
    const release = await this.findLatest(application, channel);
    if (release === null) return null;
    return toReleaseResponse(release);
  }

  public async check(input: VersionCheckInput): Promise<unknown> {
    const release = await this.findLatest(input.application, input.channel);
    if (input.clientId !== undefined) {
      await prismaClient.updateInstallation.upsert({
        where: {
          clientId_application: {
            clientId: input.clientId,
            application: toApplication(input.application),
          },
        },
        create: {
          clientId: input.clientId,
          application: toApplication(input.application),
          channel: toChannel(input.channel),
          currentVersion: input.currentVersion,
        },
        update: {
          channel: toChannel(input.channel),
          currentVersion: input.currentVersion,
          lastSeenAt: new Date(),
        },
      });
    }
    const shouldUpdate =
      release !== null && compareVersions(release.version, input.currentVersion) > 0;
    return {
      status: shouldUpdate ? 'update' : 'updated',
      update: shouldUpdate,
      currentVersion: input.currentVersion,
      latestVersion: release?.version ?? input.currentVersion,
      release: release === null ? null : toReleaseResponse(release),
      checkedAt: new Date().toISOString(),
    };
  }

  public async recordEvent(input: UpdateEventInput): Promise<void> {
    const application = toApplication(input.application);
    const channel = toChannel(input.channel);
    const currentVersion = resolveCurrentVersion(input);
    await prismaClient.$transaction([
      prismaClient.updateAuditEvent.create({
        data: {
          clientId: input.clientId,
          application,
          channel,
          event: input.event,
          ...(input.previousVersion === undefined
            ? {}
            : { previousVersion: input.previousVersion }),
          ...(input.newVersion === undefined ? {} : { newVersion: input.newVersion }),
          ...(input.durationMilliseconds === undefined
            ? {}
            : { durationMilliseconds: input.durationMilliseconds }),
          ...(input.error === undefined ? {} : { error: input.error }),
          ...(input.userId === undefined ? {} : { userId: input.userId }),
          ...(input.metadata === undefined
            ? {}
            : { metadata: input.metadata as Prisma.InputJsonValue }),
        },
      }),
      prismaClient.updateInstallation.upsert({
        where: { clientId_application: { clientId: input.clientId, application } },
        create: {
          clientId: input.clientId,
          application,
          channel,
          currentVersion,
          ...(input.previousVersion === undefined
            ? {}
            : { previousVersion: input.previousVersion }),
          ...(input.userId === undefined ? {} : { userId: input.userId }),
        },
        update: {
          channel,
          currentVersion,
          ...(input.previousVersion === undefined
            ? {}
            : { previousVersion: input.previousVersion }),
          ...(input.userId === undefined ? {} : { userId: input.userId }),
          lastSeenAt: new Date(),
        },
      }),
    ]);
  }

  public async metrics(): Promise<unknown> {
    const [releases, installations] = await Promise.all([
      prismaClient.updateRelease.findMany({ where: { published: true } }),
      prismaClient.updateInstallation.findMany(),
    ]);
    const groups: Array<{ application: VersionApplication; channel: VersionChannel }> = [];
    for (const application of ['teacher', 'student'] as const) {
      for (const channel of ['stable', 'beta', 'development'] as const)
        groups.push({ application, channel });
    }
    return {
      items: groups.map(({ application, channel }) => {
        const candidates = releases
          .filter(
            (release) =>
              release.application === toApplication(application) &&
              release.channel === toChannel(channel),
          )
          .sort((left, right) => compareVersions(right.version, left.version));
        const latest = candidates[0];
        const clients = installations.filter(
          (installation) =>
            installation.application === toApplication(application) &&
            installation.channel === toChannel(channel),
        );
        return {
          application,
          channel,
          latestVersion: latest?.version ?? null,
          publishedAt: latest?.publishedAt.toISOString() ?? null,
          totalClients: clients.length,
          updatedClients:
            latest === undefined
              ? clients.length
              : clients.filter(
                  (client) => compareVersions(client.currentVersion, latest.version) >= 0,
                ).length,
          outdatedClients:
            latest === undefined
              ? 0
              : clients.filter(
                  (client) => compareVersions(client.currentVersion, latest.version) < 0,
                ).length,
          currentVersions: Object.entries(
            clients.reduce<Record<string, number>>((counts, client) => {
              counts[client.currentVersion] = (counts[client.currentVersion] ?? 0) + 1;
              return counts;
            }, {}),
          ).map(([version, count]) => ({ version, count })),
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  public async publish(input: PublishReleaseInput): Promise<unknown> {
    const release = await prismaClient.updateRelease.upsert({
      where: {
        application_channel_version: {
          application: toApplication(input.application),
          channel: toChannel(input.channel),
          version: input.version,
        },
      },
      create: {
        application: toApplication(input.application),
        channel: toChannel(input.channel),
        version: input.version,
        releaseNotes: input.releaseNotes as Prisma.InputJsonValue,
        downloadUrl: input.url,
        sha512: input.sha512,
        checksum: input.checksum,
        ...(input.signature === undefined ? {} : { signature: input.signature }),
        ...(input.publishedAt === undefined ? {} : { publishedAt: new Date(input.publishedAt) }),
      },
      update: {
        releaseNotes: input.releaseNotes as Prisma.InputJsonValue,
        downloadUrl: input.url,
        sha512: input.sha512,
        checksum: input.checksum,
        signature: input.signature ?? null,
        published: true,
        ...(input.publishedAt === undefined ? {} : { publishedAt: new Date(input.publishedAt) }),
      },
    });
    return toReleaseResponse(release);
  }

  private findLatest(application: VersionApplication, channel: VersionChannel) {
    return prismaClient.updateRelease
      .findMany({
        where: {
          application: toApplication(application),
          channel: toChannel(channel),
          published: true,
        },
      })
      .then(
        (releases) =>
          releases.sort((left, right) => compareVersions(right.version, left.version))[0] ?? null,
      );
  }
}

function toApplication(value: VersionApplication): 'TEACHER' | 'STUDENT' {
  return value === 'teacher' ? 'TEACHER' : 'STUDENT';
}

function toChannel(value: VersionChannel): 'STABLE' | 'BETA' | 'DEVELOPMENT' {
  if (value === 'stable') return 'STABLE';
  if (value === 'beta') return 'BETA';
  return 'DEVELOPMENT';
}

function resolveCurrentVersion(input: UpdateEventInput): string {
  if (input.event === 'installation_healthy' && input.newVersion !== undefined)
    return input.newVersion;
  return input.previousVersion ?? input.newVersion ?? '0.0.0';
}

function toReleaseResponse(release: {
  version: string;
  channel: string;
  releaseNotes: unknown;
  downloadUrl: string;
  sha512: string;
  checksum: string;
  signature: string | null;
  publishedAt: Date;
}): unknown {
  return {
    version: release.version,
    channel: release.channel.toLowerCase(),
    releaseNotes: release.releaseNotes,
    url: release.downloadUrl,
    hash: release.sha512,
    checksum: release.checksum,
    signature: release.signature,
    date: release.publishedAt.toISOString(),
  };
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): [number[], string] => {
    const [core = '0.0.0', prerelease = ''] = value.trim().replace(/^v/i, '').split('-', 2);
    return [core.split('.').map((part) => Number.parseInt(part, 10) || 0), prerelease];
  };
  const [a, aPre] = parse(left);
  const [b, bPre] = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  if (aPre === bPre) return 0;
  if (aPre === '') return 1;
  if (bPre === '') return -1;
  return aPre.localeCompare(bPre, undefined, { numeric: true });
}
