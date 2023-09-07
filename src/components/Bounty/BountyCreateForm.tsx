import {
  Button,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  TooltipProps,
  SimpleGrid,
  Paper,
  ActionIcon,
  Progress,
  Divider,
} from '@mantine/core';
import { BountyEntryMode, BountyMode, BountyType, Currency, TagTarget } from '@prisma/client';
import { IconInfoCircle, IconQuestionMark, IconTrash } from '@tabler/icons-react';
import { useRouter } from 'next/router';
import React, { useMemo, useState } from 'react';

import { BackButton } from '~/components/BackButton/BackButton';
import { matureLabel } from '~/components/Post/Edit/EditPostControls';
import { useFormStorage } from '~/hooks/useFormStorage';
import {
  Form,
  InputCheckbox,
  InputDatePicker,
  InputMultiFileUpload,
  InputNumber,
  InputRTE,
  InputSelect,
  InputText,
  useForm,
} from '~/libs/form';
import { showErrorNotification } from '~/utils/notifications';
import { trpc } from '~/utils/trpc';
import { CreateBountyInput, createBountyInputSchema } from '~/server/schema/bounty.schema';
import { useCFImageUpload } from '~/hooks/useCFImageUpload';
import { ImageDropzone } from '~/components/Image/ImageDropzone/ImageDropzone';
import { IMAGE_MIME_TYPE, VIDEO_MIME_TYPE } from '~/server/common/mime-types';
import { EdgeMedia } from '~/components/EdgeMedia/EdgeMedia';
import { ImageMetaPopover } from '~/components/ImageMeta/ImageMeta';
import { MediaHash } from '~/components/ImageHash/ImageHash';
import { AlertWithIcon } from '~/components/AlertWithIcon/AlertWithIcon';
import dayjs from 'dayjs';
import { getDisplayName } from '~/utils/string-helpers';
import { constants, MIN_CREATE_BOUNTY_AMOUNT } from '~/server/common/constants';
import { TRPCClientError } from '@trpc/client';
import { z } from 'zod';

const tooltipProps: Partial<TooltipProps> = {
  maw: 300,
  multiline: true,
  position: 'bottom',
  withArrow: true,
};

const formSchema = createBountyInputSchema.omit({
  images: true,
});

export function BountyCreateForm() {
  const router = useRouter();

  const { files: imageFiles, uploadToCF, removeImage } = useCFImageUpload();

  const handleDropImages = async (droppedFiles: File[]) => {
    for (const file of droppedFiles) {
      uploadToCF(file);
    }
  };

  const { minStartDate, maxStartDate, minExpiresDate, maxExpiresDate } = useMemo(
    () => ({
      minStartDate: dayjs().startOf('day').toDate(),
      maxStartDate: dayjs().add(1, 'month').toDate(),
      minExpiresDate: dayjs().add(1, 'day').toDate(),
      maxExpiresDate: dayjs().add(1, 'day').add(1, 'month').toDate(),
    }),
    []
  );

  const form = useForm({
    schema: formSchema,
    defaultValues: {
      name: '',
      description: '',
      tags: [],
      unitAmount: MIN_CREATE_BOUNTY_AMOUNT,
      nsfw: false,
      currency: Currency.BUZZ,
      type: BountyType.LoraCreation,
      mode: BountyMode.Individual,
      entryMode: BountyEntryMode.Open,
      minBenefactorUnitAmount: MIN_CREATE_BOUNTY_AMOUNT,
      entryLimit: 1,
      files: [],
      expiresAt: dayjs().add(7, 'day').toDate(),
      startsAt: new Date(),
      details: {},
    },
    shouldUnregister: false,
  });

  const clearStorage = useFormStorage({
    schema: formSchema,
    form,
    timeout: 1000,
    key: `bounty_new`,
    watch: ({ mode, name, type, nsfw, currency, description, entryMode, unitAmount }) => ({
      mode,
      name,
      nsfw,
      currency,
      description,
      entryMode,
      unitAmount,
      type,
    }),
  });
  const type = form.watch('type');
  const mode = form.watch('mode');
  const currency = form.watch('currency');
  const entryMode = form.watch('entryMode');
  const unitAmount = form.watch('unitAmount');
  const [creating, setCreating] = useState(false);
  const requireBaseModelSelection = [
    BountyType.ModelCreation,
    BountyType.LoraCreation,
    BountyType.EmbedCreation,
  ].some((t) => t === type);

  const bountyCreateMutation = trpc.bounty.create.useMutation();

  const handleSubmit = ({ ...data }: z.infer<typeof formSchema>) => {
    const filteredImages = imageFiles
      .filter((file) => file.status === 'success')
      .map(({ id, url, ...file }) => ({ ...file, url: id })); ///

    bountyCreateMutation.mutate(
      { ...data, images: filteredImages },
      {
        async onSuccess(result) {
          await router.push(`/bounties/${result.id}`);
          clearStorage();
        },
        onError(error) {
          if (error instanceof TRPCClientError) {
            const parsedError = JSON.parse(error.message);
            showErrorNotification({
              title: 'Failed to create bounty',
              error: new Error(
                Array.isArray(parsedError) ? parsedError[0].message : parsedError.message
              ),
            });
          } else {
            showErrorNotification({
              title: 'Failed to create bounty',
              error: new Error(error.message),
            });
          }
        },
      }
    );
  };

  return (
    <Form form={form} onSubmit={handleSubmit}>
      <Stack spacing="xl">
        <Group spacing={4}>
          <BackButton url="/bounties" />
          <Title>Create new Bounty</Title>
        </Group>
        <Divider label="Bounty details" />
        <Group spacing="xs" grow>
          <InputSelect
            name="type"
            label="Bounty Type"
            placeholder="Please select a bounty type"
            withAsterisk
            style={{ flex: 1 }}
            data={Object.values(BountyType).map((value) => ({
              value,
              label: getDisplayName(value),
            }))}
          />
          {requireBaseModelSelection && (
            <InputSelect
              name="details.baseModel"
              label="Base model"
              placeholder="Please select a base model"
              withAsterisk
              style={{ flex: 1 }}
              data={constants.baseModels.map((x) => ({ value: x, label: x }))}
            />
          )}
        </Group>
        <InputText name="name" label="Name" placeholder="e.g.:LoRA for XYZ" withAsterisk />
        <InputCheckbox
          name="nsfw"
          label={
            <Group spacing={4}>
              Mature
              <Tooltip label={matureLabel} {...tooltipProps}>
                <ThemeIcon radius="xl" size="xs" color="gray">
                  <IconQuestionMark />
                </ThemeIcon>
              </Tooltip>
            </Group>
          }
        />
        <InputRTE
          name="description"
          label="Description"
          editorSize="xl"
          includeControls={['heading', 'formatting', 'list', 'link', 'media', 'polls', 'colors']}
          withAsterisk
          stickyToolbar
        />
        <Stack>
          <InputSelect
            name="mode"
            label="Bounty Mode"
            placeholder="Please select a bounty mode"
            withAsterisk
            style={{ flex: 1 }}
            data={Object.values(BountyMode)}
          />
          <AlertWithIcon icon={<IconInfoCircle />} iconSize="md">
            {mode === BountyMode.Individual && (
              <Text>
                Only you will be the benefactor of this bounty. This is great if you are offering a
                good reward for a really specific resource that you want tailored for your specific
                needs. The number of entries might be limited if the reward you are offering is not
                enticing enough.
              </Text>
            )}
            {mode === BountyMode.Split && (
              <Text>
                Other users can become a benefactor in your bounty and select other entries to
                support. This is great for incentivizing a large number of people to contribute to
                submit entries to your bounty.
              </Text>
            )}
          </AlertWithIcon>
        </Stack>
        <Stack>
          <InputSelect
            name="entryMode"
            label="Entry Mode"
            placeholder="Please select an entry mode"
            withAsterisk
            style={{ flex: 1 }}
            data={Object.values(BountyEntryMode)}
          />
          <AlertWithIcon icon={<IconInfoCircle />} iconSize="md">
            <Text>Entry mode affects how we treat entries in your bounty.</Text>
            {entryMode === BountyEntryMode.Open && (
              <Text>
                By selecting the Open entry mode, any user, at any time, can support an entry and
                gain access to its files.
              </Text>
            )}
            {entryMode === BountyEntryMode.BenefactorsOnly && (
              <Text>
                By selecting the Benefactors Only entry mode, only people who become benefactors in
                your bounty can support an entry and gain access to the files. Each benefactor can
                only select 1 entry they support. So at best, each benefactor will have access to 1
                set of files.
              </Text>
            )}
          </AlertWithIcon>
        </Stack>
        <Divider label="Bounty rewards" />
        <Group spacing="xs" grow>
          <InputNumber
            name="unitAmount"
            label="Bounty Amount"
            placeholder="How much are you willing to reward for this bounty"
            min={MIN_CREATE_BOUNTY_AMOUNT}
            max={100000}
            sx={{ flexGrow: 1 }}
            format={currency !== Currency.BUZZ ? 'currency' : undefined}
            withAsterisk
          />

          <InputNumber
            name="entryLimit"
            label="Max entries per hunter"
            placeholder="How many entries can a hunter submit to your bounty"
            min={1}
            max={100000}
            sx={{ flexGrow: 1 }}
            withAsterisk
          />

          {mode === BountyMode.Split && (
            <InputNumber
              name="minBenefactorUnitAmount"
              label="Minimum Benefactor Amount"
              placeholder="How much does a benefactor need to contribute to your bounty to become a benefactor"
              min={0}
              max={unitAmount}
              sx={{ flexGrow: 1 }}
              format={currency !== Currency.BUZZ ? 'currency' : undefined}
            />
          )}
        </Group>
        <Divider label="Dates" />
        <Group spacing="xs" grow>
          <InputDatePicker
            name="startsAt"
            label="Start Date"
            placeholder="Select a starts date"
            withAsterisk
            minDate={minStartDate}
            maxDate={maxStartDate}
          />
          <InputDatePicker
            name="expiresAt"
            label="Expiration Date"
            placeholder="Select an end date"
            withAsterisk
            minDate={minExpiresDate}
            maxDate={maxExpiresDate}
          />
        </Group>

        <Divider label="Bounty Images" />
        <Text>
          Please add at least 1 reference image to your bounty. This will serve as a reference point
          for Hunters and will also be used as your cover image.
        </Text>
        <ImageDropzone
          label="Drag & drop images here or click to browse"
          onDrop={handleDropImages}
          count={imageFiles.length}
          accept={[...IMAGE_MIME_TYPE, ...VIDEO_MIME_TYPE]}
        />
        {imageFiles.length > 0 && (
          <SimpleGrid
            spacing="sm"
            breakpoints={[
              { minWidth: 'xs', cols: 1 },
              { minWidth: 'sm', cols: 3 },
              { minWidth: 'md', cols: 4 },
            ]}
          >
            {imageFiles
              .slice()
              .reverse()
              .map((file) => (
                <Paper
                  key={file.id}
                  radius="sm"
                  p={0}
                  sx={{ position: 'relative', overflow: 'hidden', height: 332 }}
                  withBorder
                >
                  {file.status === 'success' ? (
                    <>
                      <EdgeMedia
                        placeholder="empty"
                        src={file.id}
                        alt={file.name ?? undefined}
                        style={{ objectFit: 'cover', height: '100%' }}
                      />
                      <div style={{ position: 'absolute', top: 12, right: 12 }}>
                        <ActionIcon
                          variant="filled"
                          size="lg"
                          color="red"
                          onClick={() => removeImage(file.id)}
                        >
                          <IconTrash size={26} strokeWidth={2.5} />
                        </ActionIcon>
                      </div>
                      {file.type === 'image' && (
                        <div style={{ position: 'absolute', bottom: 12, right: 12 }}>
                          <ImageMetaPopover meta={file.meta}>
                            <ActionIcon variant="light" color="dark" size="lg">
                              <IconInfoCircle color="white" strokeWidth={2.5} size={26} />
                            </ActionIcon>
                          </ImageMetaPopover>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <MediaHash {...file} />
                      <Progress
                        size="xl"
                        value={file.progress}
                        label={`${Math.floor(file.progress)}%`}
                        color={file.progress < 100 ? 'blue' : 'green'}
                        striped
                        animate
                      />
                    </>
                  )}
                </Paper>
              ))}
          </SimpleGrid>
        )}
        <InputMultiFileUpload
          name="files"
          label="Attachments"
          dropzoneProps={{
            maxSize: 100 * 1024 ** 2, // 100MB
            maxFiles: 10,
            accept: {
              'application/pdf': ['.pdf'],
              'application/zip': ['.zip'],
              'application/json': ['.json'],
              'application/x-yaml': ['.yaml', '.yml'],
              'text/plain': ['.txt'],
              'text/markdown': ['.md'],
              'text/x-python-script': ['.py'],
            },
          }}
        />

        <Group mt="xl" position="right">
          <Button
            loading={bountyCreateMutation.isLoading && !creating}
            disabled={bountyCreateMutation.isLoading}
            onClick={() => setCreating(false)}
            type="submit"
            fullWidth
          >
            Save
          </Button>
        </Group>
      </Stack>
    </Form>
  );
}
