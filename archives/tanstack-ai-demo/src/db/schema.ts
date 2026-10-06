import {
  pgTable,
  varchar,
  text,
  timestamp,
  boolean,
  index,
} from 'drizzle-orm/pg-core'

// Helper to generate IDs
const generateId = () => crypto.randomUUID()

// Chats table
export const chats = pgTable('chats', {
  id: varchar()
    .primaryKey()
    .$defaultFn(() => generateId()),
  title: varchar().default('New Chat').notNull(),
  isPinned: boolean().default(false).notNull(),
  createdAt: timestamp().defaultNow().notNull(),
  updatedAt: timestamp().defaultNow().notNull(),
})

// Messages table
export const messages = pgTable(
  'messages',
  {
    id: varchar()
      .primaryKey()
      .$defaultFn(() => generateId()),
    chatId: varchar()
      .references(() => chats.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp().defaultNow().notNull(),
    role: varchar().$type<'user' | 'assistant' | 'system'>().notNull(),
    content: text('content').notNull(),
  },
  (table) => [
    index('messages_chat_id_idx').on(table.chatId),
    index('messages_chat_id_created_at_idx').on(table.chatId, table.createdAt),
  ],
)
