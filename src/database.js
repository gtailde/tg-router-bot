/**
 * Database layer — better-sqlite3 (synchronous, fast, no native build issues).
 * All tables: users, topics, chats, tickets, ticket_messages
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'bot.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = FULL');  // Ensure data is flushed to disk
db.pragma('cache_size = -64000');   // 64MB cache

// ==================== Schema ==================== //

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id   INTEGER UNIQUE,
    username      TEXT,
    first_name    TEXT,
    role          TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS topics (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT UNIQUE NOT NULL,
    description   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS chats (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id       INTEGER UNIQUE NOT NULL,
    title         TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT NOT NULL,
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','closed')),
    author_id       INTEGER NOT NULL REFERENCES users(id),
    topic_id        INTEGER REFERENCES topics(id),
    chat_id         INTEGER REFERENCES chats(id),
    user_message_id INTEGER,
    chat_message_id INTEGER,
    responsible_tg_id INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_messages (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id         INTEGER NOT NULL REFERENCES tickets(id),
    sender_tg_id      INTEGER NOT NULL,
    text              TEXT,
    user_dm_message_id INTEGER,
    chat_message_id   INTEGER,
    created_at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ==================== Migrations ==================== //

try { db.exec('ALTER TABLE topics ADD COLUMN chat_id INTEGER REFERENCES chats(id)'); } catch(e) { /* already exists */ }
try { db.exec('ALTER TABLE users ADD COLUMN display_name TEXT'); } catch(e) { /* already exists */ }

db.exec(`
  CREATE TABLE IF NOT EXISTS topic_developers (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id  INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(topic_id, user_id)
  );
`);

// ==================== Users ==================== //

const stmts = {
  // Users
  getUserByTgId: db.prepare('SELECT * FROM users WHERE telegram_id = ?'),
  getUserByUsername: db.prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)'),
  insertUser: db.prepare(`
    INSERT INTO users (telegram_id, username, first_name, role)
    VALUES (@telegram_id, @username, @first_name, @role)
  `),
  updateUserMeta: db.prepare(`
    UPDATE users SET username = @username, first_name = @first_name WHERE telegram_id = @telegram_id
  `),
  updateUserTgId: db.prepare('UPDATE users SET telegram_id = @telegram_id, first_name = @first_name WHERE id = @id'),
  setUserRole: db.prepare('UPDATE users SET role = @role WHERE telegram_id = @telegram_id'),
  setDisplayName: db.prepare('UPDATE users SET display_name = @display_name WHERE id = @id'),
  getUserById: db.prepare('SELECT * FROM users WHERE id = ?'),
  listUsers: db.prepare('SELECT * FROM users ORDER BY id'),
  listAdmins: db.prepare("SELECT * FROM users WHERE role = 'admin'"),

  // Topics
  insertTopic: db.prepare('INSERT INTO topics (name, description) VALUES (@name, @description)'),
  getTopicById: db.prepare('SELECT * FROM topics WHERE id = ?'),
  listTopics: db.prepare('SELECT * FROM topics ORDER BY name'),
  deleteTopic: db.prepare('DELETE FROM topics WHERE id = ?'),
  getTopicWithChat: db.prepare(`
    SELECT t.*, c.title AS chat_title, c.chat_id AS target_chat_id
    FROM topics t LEFT JOIN chats c ON t.chat_id = c.id
    WHERE t.id = ?
  `),
  listTopicsWithChats: db.prepare(`
    SELECT t.*, c.title AS chat_title
    FROM topics t LEFT JOIN chats c ON t.chat_id = c.id
    ORDER BY t.name
  `),
  setTopicChat: db.prepare('UPDATE topics SET chat_id = @chat_id WHERE id = @id'),

  // Topic developers
  listTopicDevs: db.prepare(`
    SELECT u.id, u.telegram_id, u.username, u.first_name, u.display_name, u.role
    FROM topic_developers td JOIN users u ON td.user_id = u.id
    WHERE td.topic_id = ?
  `),
  addTopicDev: db.prepare('INSERT OR IGNORE INTO topic_developers (topic_id, user_id) VALUES (@topic_id, @user_id)'),
  removeTopicDev: db.prepare('DELETE FROM topic_developers WHERE topic_id = @topic_id AND user_id = @user_id'),
  removeAllTopicDevs: db.prepare('DELETE FROM topic_developers WHERE topic_id = ?'),

  // Chats
  getChatByChatId: db.prepare('SELECT * FROM chats WHERE chat_id = ?'),
  insertChat: db.prepare('INSERT OR IGNORE INTO chats (chat_id, title) VALUES (@chat_id, @title)'),
  updateChatTitle: db.prepare('UPDATE chats SET title = @title, is_active = 1 WHERE chat_id = @chat_id'),
  listActiveChats: db.prepare("SELECT * FROM chats WHERE is_active = 1 ORDER BY id"),
  listAllChats: db.prepare('SELECT * FROM chats ORDER BY id'),
  deactivateChat: db.prepare('UPDATE chats SET is_active = 0 WHERE chat_id = ?'),
  activateChat: db.prepare('UPDATE chats SET is_active = 1 WHERE chat_id = ?'),

  // Tickets
  insertTicket: db.prepare(`
    INSERT INTO tickets (title, description, author_id, topic_id, chat_id, responsible_tg_id)
    VALUES (@title, @description, @author_id, @topic_id, @chat_id, @responsible_tg_id)
  `),
  getTicket: db.prepare(`
    SELECT t.*, u.telegram_id AS author_tg_id, u.username AS author_username,
           u.first_name AS author_first_name, u.display_name AS author_display_name,
           tp.name AS topic_name, c.chat_id AS target_chat_id, c.title AS chat_title
    FROM tickets t
    LEFT JOIN users u ON t.author_id = u.id
    LEFT JOIN topics tp ON t.topic_id = tp.id
    LEFT JOIN chats c ON t.chat_id = c.id
    WHERE t.id = ?
  `),
  updateTicketChatMsgId: db.prepare('UPDATE tickets SET chat_message_id = ? WHERE id = ?'),
  updateTicketUserMsgId: db.prepare('UPDATE tickets SET user_message_id = ? WHERE id = ?'),
  setTicketStatus: db.prepare("UPDATE tickets SET status = @status, updated_at = datetime('now') WHERE id = @id"),
  listOpenTickets: db.prepare(`
    SELECT t.*, u.first_name AS author_first_name, u.username AS author_username,
           u.display_name AS author_display_name, tp.name AS topic_name
    FROM tickets t
    LEFT JOIN users u ON t.author_id = u.id
    LEFT JOIN topics tp ON t.topic_id = tp.id
    WHERE t.status IN ('open','in_progress')
    ORDER BY t.created_at DESC
  `),
  listAllTickets: db.prepare(`
    SELECT t.*, u.first_name AS author_first_name, u.username AS author_username,
           u.display_name AS author_display_name, tp.name AS topic_name
    FROM tickets t
    LEFT JOIN users u ON t.author_id = u.id
    LEFT JOIN topics tp ON t.topic_id = tp.id
    ORDER BY t.created_at DESC
  `),
  listTicketsByStatus: db.prepare(`
    SELECT t.*, u.first_name AS author_first_name, u.username AS author_username,
           u.display_name AS author_display_name, tp.name AS topic_name
    FROM tickets t
    LEFT JOIN users u ON t.author_id = u.id
    LEFT JOIN topics tp ON t.topic_id = tp.id
    WHERE t.status = ?
    ORDER BY t.created_at DESC
  `),
  listTicketsByAuthor: db.prepare(`
    SELECT t.*, u.first_name AS author_first_name, u.username AS author_username,
           u.display_name AS author_display_name, tp.name AS topic_name
    FROM tickets t
    LEFT JOIN users u ON t.author_id = u.id
    LEFT JOIN topics tp ON t.topic_id = tp.id
    WHERE t.author_id = @author_id
    ORDER BY t.created_at DESC
  `),
  listTicketsByDev: db.prepare(`
    SELECT DISTINCT t.*, u.first_name AS author_first_name, u.username AS author_username,
           u.display_name AS author_display_name, tp.name AS topic_name
    FROM tickets t
    LEFT JOIN users u ON t.author_id = u.id
    LEFT JOIN topics tp ON t.topic_id = tp.id
    JOIN topic_developers td ON t.topic_id = td.topic_id
    WHERE td.user_id = @dev_id
    ORDER BY t.created_at DESC
  `),
  ticketStats: db.prepare(`
    SELECT
      COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open_count,
      COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress_count,
      COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) AS closed_count
    FROM tickets
  `),
  listUserTickets: db.prepare(`
    SELECT t.*, tp.name AS topic_name
    FROM tickets t
    LEFT JOIN topics tp ON t.topic_id = tp.id
    WHERE t.author_id = ?
    ORDER BY t.created_at DESC
  `),
  getStaleTickets: db.prepare(`
    SELECT t.*, u.telegram_id AS author_tg_id, c.chat_id AS target_chat_id
    FROM tickets t
    LEFT JOIN users u ON t.author_id = u.id
    LEFT JOIN chats c ON t.chat_id = c.id
    WHERE t.status IN ('open','in_progress')
      AND t.updated_at < datetime('now', '-' || ? || ' minutes')
  `),

  // Ticket messages
  insertTicketMsg: db.prepare(`
    INSERT INTO ticket_messages (ticket_id, sender_tg_id, text, user_dm_message_id, chat_message_id)
    VALUES (@ticket_id, @sender_tg_id, @text, @user_dm_message_id, @chat_message_id)
  `),
  listTicketMessages: db.prepare(`
    SELECT tm.*, u.first_name, u.username, u.display_name, u.role
    FROM ticket_messages tm
    LEFT JOIN users u ON tm.sender_tg_id = u.telegram_id
    WHERE tm.ticket_id = ?
    ORDER BY tm.created_at ASC
  `),
  findTicketByChatMsgId: db.prepare(`
    SELECT t.*, u.telegram_id AS author_tg_id, u.first_name AS author_first_name,
           c.chat_id AS target_chat_id
    FROM tickets t
    LEFT JOIN users u ON t.author_id = u.id
    LEFT JOIN chats c ON t.chat_id = c.id
    WHERE t.chat_message_id = ?
  `),
  findTicketByTmChatMsgId: db.prepare(`
    SELECT t.*, u.telegram_id AS author_tg_id, u.first_name AS author_first_name,
           c.chat_id AS target_chat_id
    FROM ticket_messages tm
    JOIN tickets t ON tm.ticket_id = t.id
    LEFT JOIN users u ON t.author_id = u.id
    LEFT JOIN chats c ON t.chat_id = c.id
    WHERE tm.chat_message_id = ?
  `),
};

// ==================== Helpers ==================== //

function verifyDbFileExists() {
  const dbPath = path.join(DATA_DIR, 'bot.db');
  if (fs.existsSync(dbPath)) {
    const stats = fs.statSync(dbPath);
    console.log(`[db] Database file: ${dbPath} (${stats.size} bytes)`);
    return true;
  }
  console.error(`[db] Database file NOT found: ${dbPath}`);
  return false;
}

verifyDbFileExists();

// ==================== Helpers (cont) ==================== //

function getOrCreateUser(telegramId, username, firstName, role = 'user') {
  let user = stmts.getUserByTgId.get(telegramId);
  if (user) {
    stmts.updateUserMeta.run({ username, first_name: firstName, telegram_id: telegramId });
    return stmts.getUserByTgId.get(telegramId);
  }
  stmts.insertUser.run({ telegram_id: telegramId, username, first_name: firstName, role });
  return stmts.getUserByTgId.get(telegramId);
}

function addUserByUsername(username, role = 'user') {
  // Create a "placeholder" user with no telegram_id yet — they will be linked on /start
  const clean = username.replace(/^@/, '').toLowerCase();
  let user = stmts.getUserByUsername.get(clean);
  if (user) return user;
  db.prepare('INSERT INTO users (telegram_id, username, role) VALUES (NULL, @username, @role)')
    .run({ username: clean, role });
  return stmts.getUserByUsername.get(clean);
}

function linkUserTgId(telegramId, username, firstName) {
  // When user sends /start, check if there's a placeholder row by username
  const clean = (username || '').toLowerCase();
  if (clean) {
    const placeholder = db.prepare('SELECT * FROM users WHERE LOWER(username) = ? AND telegram_id IS NULL').get(clean);
    if (placeholder) {
      stmts.updateUserTgId.run({ telegram_id: telegramId, first_name: firstName, id: placeholder.id });
      return stmts.getUserByTgId.get(telegramId);
    }
  }
  return null;
}

function addOrUpdateChat(chatId, title) {
  const existing = stmts.getChatByChatId.get(chatId);
  if (existing) {
    stmts.updateChatTitle.run({ title, chat_id: chatId });
    return stmts.getChatByChatId.get(chatId);
  }
  stmts.insertChat.run({ chat_id: chatId, title });
  return stmts.getChatByChatId.get(chatId);
}

function createTicket({ title, description, authorId, topicId, chatDbId, responsibleTgId }) {
  const info = stmts.insertTicket.run({
    title,
    description: description || null,
    author_id: authorId,
    topic_id: topicId || null,
    chat_id: chatDbId || null,
    responsible_tg_id: responsibleTgId || null,
  });
  return stmts.getTicket.get(info.lastInsertRowid);
}

function findTicketByChatMsgId(chatMessageId) {
  let t = stmts.findTicketByChatMsgId.get(chatMessageId);
  if (t) return t;
  return stmts.findTicketByTmChatMsgId.get(chatMessageId);
}

module.exports = {
  db,
  stmts,
  getOrCreateUser,
  addUserByUsername,
  linkUserTgId,
  addOrUpdateChat,
  createTicket,
  findTicketByChatMsgId,
};
