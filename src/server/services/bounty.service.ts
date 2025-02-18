import {
  BountyEntryMode,
  Currency,
  ImageIngestionStatus,
  MetricTimeframe,
  Prisma,
  TagTarget,
} from '@prisma/client';
import { dbRead, dbWrite } from '../db/client';
import { GetByIdInput } from '../schema/base.schema';
import { updateEntityFiles } from './file.service';
import {
  throwBadRequestError,
  throwInsufficientFundsError,
  throwNotFoundError,
} from '../utils/errorHandling';
import {
  AddBenefactorUnitAmountInputSchema,
  BountyDetailsSchema,
  CreateBountyInput,
  GetInfiniteBountySchema,
  UpdateBountyInput,
} from '../schema/bounty.schema';
import { imageSelect } from '../selectors/image.selector';
import { createBuzzTransaction, getUserBuzzAccount } from '~/server/services/buzz.service';
import { TransactionType } from '~/server/schema/buzz.schema';
import { createEntityImages, ingestImage } from '~/server/services/image.service';
import { chunk, groupBy } from 'lodash-es';
import { BountySort, BountyStatus } from '../common/enums';
import { isNotTag, isTag } from '../schema/tag.schema';
import { decreaseDate } from '~/utils/date-helpers';
import { ManipulateType } from 'dayjs';

export const getAllBounties = <TSelect extends Prisma.BountySelect>({
  input: {
    cursor,
    limit: take,
    query,
    sort,
    types,
    status,
    mode,
    engagement,
    userId,
    period,
    baseModels,
  },
  select,
}: {
  input: GetInfiniteBountySchema;
  select: TSelect;
}) => {
  const AND: Prisma.Enumerable<Prisma.BountyWhereInput> = [];

  if (userId && engagement) {
    if (engagement === 'favorite')
      AND.push({ engagements: { some: { type: 'Favorite', userId } } });
    if (engagement === 'tracking') AND.push({ engagements: { some: { type: 'Track', userId } } });
    if (engagement === 'supporter') AND.push({ benefactors: { some: { userId } } });
    if (engagement === 'awarded') AND.push({ benefactors: { some: { awartedTo: { userId } } } });
  }

  if (baseModels && baseModels.length) {
    AND.push({
      OR: baseModels.map((base) => ({ details: { path: ['baseModel'], equals: base } })),
    });
  }

  const orderBy: Prisma.BountyFindManyArgs['orderBy'] = [{ complete: 'asc' }];
  if (sort === BountySort.EndingSoon) orderBy.push({ expiresAt: 'asc' });
  else if (sort === BountySort.HighestBounty)
    orderBy.push({ rank: { [`unitAmountCount${period}Rank`]: 'asc' } });
  else if (sort === BountySort.MostContributors)
    orderBy.push({ rank: { [`entryCount${period}Rank`]: 'asc' } });
  else if (sort === BountySort.MostDiscussed)
    orderBy.push({ rank: { [`commentCount${period}Rank`]: 'asc' } });
  else if (sort === BountySort.MostLiked)
    orderBy.push({ rank: { [`favoriteCount${period}Rank`]: 'asc' } });
  else if (sort === BountySort.MostTracked)
    orderBy.push({ rank: { [`trackCount${period}Rank`]: 'asc' } });
  else orderBy.push({ createdAt: 'desc' });

  return dbRead.bounty.findMany({
    take,
    cursor: cursor ? { id: cursor } : undefined,
    select,
    where: {
      mode,
      name: query ? { contains: query } : undefined,
      type: types && !!types.length ? { in: types } : undefined,
      expiresAt:
        status === BountyStatus.Open
          ? { gt: new Date() }
          : status === BountyStatus.Expired
          ? { lt: new Date() }
          : undefined,
      complete:
        status === BountyStatus.Awarded ? true : status === BountyStatus.Open ? false : undefined,
      createdAt:
        period !== MetricTimeframe.AllTime
          ? { gte: decreaseDate(new Date(), 1, period.toLowerCase() as ManipulateType) }
          : undefined,
      AND,
    },
    orderBy,
  });
};

export const getBountyById = <TSelect extends Prisma.BountySelect>({
  id,
  select,
}: GetByIdInput & { select: TSelect }) => {
  return dbRead.bounty.findUnique({ where: { id }, select });
};

export const createBounty = async ({
  images,
  files,
  tags,
  unitAmount,
  currency,
  ...data
}: CreateBountyInput & { userId: number }) => {
  const { userId } = data;
  switch (currency) {
    case Currency.BUZZ:
      const account = await getUserBuzzAccount({ accountId: userId });
      if (account.balance < unitAmount) {
        throw throwInsufficientFundsError();
      }
      break;
    default: // Do no checks
      break;
  }

  const bounty = await dbWrite.$transaction(async (tx) => {
    const bounty = await tx.bounty.create({
      data: {
        ...data,
        // TODO.bounty: Once we support tipping buzz fully, need to re-enable this
        entryMode: BountyEntryMode.BenefactorsOnly,
        details: (data.details as Prisma.JsonObject) ?? Prisma.JsonNull,
        tags: tags
          ? {
              create: tags.map((tag) => {
                const name = tag.name.toLowerCase().trim();
                return {
                  tag: {
                    connectOrCreate: {
                      where: { name },
                      create: { name, target: [TagTarget.Bounty] },
                    },
                  },
                };
              }),
            }
          : undefined,
      },
    });

    await tx.bountyBenefactor.create({
      data: {
        userId,
        bountyId: bounty.id,
        unitAmount,
        currency,
      },
    });

    if (files) {
      await updateEntityFiles({ tx, entityId: bounty.id, entityType: 'Bounty', files });
    }

    if (images) {
      await createEntityImages({
        images,
        tx,
        userId,
        entityId: bounty.id,
        entityType: 'Bounty',
      });
    }

    switch (currency) {
      case Currency.BUZZ:
        await createBuzzTransaction({
          fromAccountId: userId,
          toAccountId: 0,
          amount: unitAmount,
          type: TransactionType.Bounty,
        });
        break;
      default: // Do no checks
        break;
    }

    return bounty;
  });

  return { ...bounty, details: bounty.details as BountyDetailsSchema | null };
};

export const updateBountyById = async ({ id, files, tags, ...data }: UpdateBountyInput) => {
  const bounty = await dbWrite.$transaction(async (tx) => {
    const bounty = await tx.bounty.update({
      where: { id },
      data: {
        ...data,
        tags: tags
          ? {
              deleteMany: {
                tagId: {
                  notIn: tags.filter(isTag).map((x) => x.id),
                },
              },
              connectOrCreate: tags.filter(isTag).map((tag) => ({
                where: { tagId_bountyId: { tagId: tag.id, bountyId: id } },
                create: { tagId: tag.id },
              })),
              create: tags.filter(isNotTag).map((tag) => {
                const name = tag.name.toLowerCase().trim();
                return {
                  tag: {
                    connectOrCreate: {
                      where: { name },
                      create: { name, target: [TagTarget.Bounty] },
                    },
                  },
                };
              }),
            }
          : undefined,
      },
    });
    if (!bounty) return null;

    if (files) {
      await updateEntityFiles({ tx, entityId: bounty.id, entityType: 'Bounty', files });
    }

    return bounty;
  });

  return bounty;
};

export const deleteBountyById = async ({ id }: GetByIdInput) => {
  const bounty = await getBountyById({ id, select: { userId: true } });
  if (!bounty) throw throwNotFoundError('Bounty not found');

  const benefactorsCount = await dbWrite.bountyBenefactor.count({
    where: { bountyId: id, userId: bounty.userId ? { not: bounty.userId } : undefined },
  });
  const entriesCount = await dbWrite.bountyEntry.count({ where: { bountyId: id } });

  if (benefactorsCount !== 0 || entriesCount !== 0)
    throw throwBadRequestError('Cannot delete bounty because it has supporters and/or entries');

  const deletedBounty = await dbWrite.$transaction(async (tx) => {
    const deletedBounty = await tx.bounty.delete({ where: { id } });
    if (!deletedBounty) return null;

    await tx.file.deleteMany({ where: { entityId: id, entityType: 'Bounty' } });

    return deletedBounty;
  });
  if (!deletedBounty) return null;

  // Refund the bounty creator
  if (bounty.userId) {
    const bountyCreator = await dbRead.bountyBenefactor.findUnique({
      where: { bountyId_userId: { userId: bounty.userId, bountyId: id } },
      select: { unitAmount: true, currency: true },
    });

    switch (bountyCreator?.currency) {
      case Currency.BUZZ:
        await createBuzzTransaction({
          fromAccountId: 0,
          toAccountId: bounty.userId,
          amount: bountyCreator.unitAmount,
          type: TransactionType.Refund,
          description: 'Refund reason: owner deleted bounty',
        });
        break;
      default: // Do no checks
        break;
    }
  }

  return deletedBounty;
};

export const getBountyImages = async ({ id }: GetByIdInput) => {
  const connections = await dbRead.imageConnection.findMany({
    where: { entityId: id, entityType: 'Bounty' },
    select: { image: { select: imageSelect } },
  });

  return connections.map(({ image }) => image);
};

export const getBountyFiles = async ({ id }: GetByIdInput) => {
  const files = await dbRead.file.findMany({
    where: { entityId: id, entityType: 'Bounty' },
    select: {
      id: true,
      url: true,
      metadata: true,
      sizeKB: true,
      name: true,
    },
  });

  return files;
};

export const addBenefactorUnitAmount = async ({
  bountyId,
  unitAmount,
  userId,
}: AddBenefactorUnitAmountInputSchema & { userId: number }) => {
  const bounty = await dbRead.bounty.findUnique({
    where: { id: bountyId },
    select: { complete: true },
  });

  if (!bounty) {
    throw throwNotFoundError('Bounty not found');
  }

  if (bounty.complete) {
    throw throwBadRequestError('Bounty is already complete');
  }

  const benefactor = await dbRead.bountyBenefactor.findUnique({
    where: {
      bountyId_userId: {
        userId,
        bountyId,
      },
    },
    select: {
      unitAmount: true,
      currency: true,
    },
  });

  const { currency } = benefactor || { currency: Currency.BUZZ };

  switch (currency) {
    case Currency.BUZZ:
      const account = await getUserBuzzAccount({ accountId: userId });
      if (account.balance < unitAmount) {
        throw throwInsufficientFundsError();
      }
      break;
    default: // Do no checks
      break;
  }

  switch (currency) {
    case Currency.BUZZ:
      await createBuzzTransaction({
        fromAccountId: userId,
        toAccountId: 0,
        amount: unitAmount,
        type: TransactionType.Bounty,
      });
      break;
    default: // Do no checks
      break;
  }

  // Update benefactor record;
  const updatedBenefactor = await dbWrite.bountyBenefactor.upsert({
    update: {
      unitAmount: unitAmount + (benefactor?.unitAmount ?? 0),
    },
    create: {
      userId,
      bountyId,
      unitAmount,
    },
    where: {
      bountyId_userId: {
        userId,
        bountyId,
      },
    },
  });

  return updatedBenefactor;
};

export const getImagesForBounties = async ({ bountyIds }: { bountyIds: number[] }) => {
  const connections = await dbRead.imageConnection.findMany({
    where: { entityType: 'Bounty', entityId: { in: bountyIds }, image: { ingestion: 'Scanned' } },
    select: {
      entityId: true,
      image: { select: imageSelect },
    },
  });

  const groupedImages = groupBy(
    connections.map(({ entityId, image }) => ({
      ...image,
      tags: image.tags.map((t) => ({ id: t.tag.id, name: t.tag.name })),
      entityId,
    })),
    'entityId'
  );

  return groupedImages;
};
