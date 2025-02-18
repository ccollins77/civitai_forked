import { Prisma } from '@prisma/client';
import { userWithCosmeticsSelect } from './user.selector';

export const getBountyDetailsSelect = Prisma.validator<Prisma.BountySelect>()({
  id: true,
  name: true,
  description: true,
  details: true,
  createdAt: true,
  type: true,
  expiresAt: true,
  startsAt: true,
  minBenefactorUnitAmount: true,
  mode: true,
  entryMode: true,
  entryLimit: true,
  nsfw: true,
  complete: true,
  user: { select: userWithCosmeticsSelect },
  tags: { select: { tag: { select: { id: true, name: true } } } },
  stats: {
    select: {
      favoriteCountAllTime: true,
      trackCountAllTime: true,
      entryCountAllTime: true,
      benefactorCountAllTime: true,
      unitAmountCountAllTime: true,
      commentCountAllTime: true,
    },
  },
});
