import { createFileRoute } from '@tanstack/react-router'

import { CreatorScreen } from '@/components/characters/CreatorScreen'

export const Route = createFileRoute('/_app/lieux/nouveau')({
  component: () => <CreatorScreen kind="place" />,
})
