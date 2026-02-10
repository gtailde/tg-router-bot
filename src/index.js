/**
 * Entry point — TaskRouter Telegram Bot (grammY, Node.js).
 *
 * Architecture:
 * - Fixed ReplyKeyboard (not inline) — different for admin / user
 * - Session-based state machine — bot remembers where you are
 * - Admin adds users by @username or forwarded message; user gets linked on /start
 * - Admin does NOT create tickets
 * - Reply from support chat → delivered to ticket author
 * - Auto-close stale tickets
 */
require('dotenv').config();

const { Bot, session } = require('grammy');
const { getOrCreateUser, linkUserTgId, addOrUpdateChat, stmts } = require('./database');
const { handleAdmin, handleAdminForward, sendMain, isAdmin } = require('./handlers/admin');
const { handleUser, sendUserMain, isUser } = require('./handlers/user');
const { handleChatReply } = require('./handlers/chatReply');
// ==================== Config ==================== //

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) { console.error('BOT_TOKEN is required in .env'); process.exit(1); }

const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)
  .map(Number);

// ==================== Bot ==================== //

const bot = new Bot(BOT_TOKEN);

// Session middleware — stores state per chat
bot.use(session({
  initial: () => ({
    user: null,   // DB user object
    state: null,  // current menu state
    step: null,   // sub-step
    draft: {},    // temp data for FSM
  }),
}));

// ==================== Auth middleware ==================== //

bot.use(async (ctx, next) => {
  // Group messages go straight to chatReply handler — no auth needed
  if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
    return next();
  }

  if (!ctx.from) return next();

  const tgId = ctx.from.id;
  const username = ctx.from.username || null;
  const firstName = ctx.from.first_name || null;

  // Fast path: check if user already in DB
  let user = stmts.getUserByTgId.get(tgId);

  if (!user) {
    // Try to link placeholder user (added by admin via username)
    user = linkUserTgId(tgId, username, firstName);
  }

  if (!user) {
    // Not in DB — only allow ADMIN_IDS
    if (ADMIN_IDS.includes(tgId)) {
      user = getOrCreateUser(tgId, username, firstName, 'admin');
    } else {
      if (ctx.message?.text === '/start') {
        await ctx.reply('⛔ Ви не зареєстровані в системі.\nЗверніться до адміністратора.');
      }
      return; // block
    }
  }

  // Update metadata only if changed
  if (user.username !== username || user.first_name !== firstName) {
    stmts.updateUserMeta.run({ username, first_name: firstName, telegram_id: tgId });
  }

  // Ensure ADMIN_IDS have admin role
  if (ADMIN_IDS.includes(tgId) && user.role !== 'admin') {
    stmts.setUserRole.run({ role: 'admin', telegram_id: tgId });
    user.role = 'admin';
  }

  ctx.session.user = user;
  return next();
});

// ==================== /start ==================== //

bot.command('start', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  const user = ctx.session.user;
  if (!user) return;

  if (user.role === 'admin') {
    await sendMain(ctx);
  } else {
    await sendUserMain(ctx);
  }
});

// ==================== /admin (shortcut) ==================== //

bot.command('admin', async (ctx) => {
  if (ctx.chat?.type !== 'private') return;
  if (ctx.session.user?.role !== 'admin') {
    await ctx.reply('⛔ У вас немає прав.');
    return;
  }
  await sendMain(ctx);
});

// ==================== Chat member events (auto-register chats) ==================== //

bot.on('my_chat_member', async (ctx) => {
  const update = ctx.myChatMember;
  if (!update) return;

  const me = ctx.me;
  if (update.new_chat_member.user.id !== me.id) return;

  const status = update.new_chat_member.status;
  if (status === 'administrator' || status === 'member') {
    addOrUpdateChat(update.chat.id, update.chat.title);
    console.log(`[chat] Registered: ${update.chat.title} (${update.chat.id})`);
  } else if (status === 'left' || status === 'kicked') {
    stmts.deactivateChat.run(update.chat.id);
    console.log(`[chat] Deactivated: ${update.chat.title} (${update.chat.id})`);
  }
});

// ==================== Message handler ==================== //

bot.on('message', async (ctx) => {
  // Group replies → ticket reply handler
  if (ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup') {
    await handleChatReply(ctx);
    return;
  }

  // Private chat only from here
  if (ctx.chat?.type !== 'private') return;
  if (!ctx.session.user) return;

  // Handle forwarded messages (admin adding user)
  if (ctx.message?.forward_from) {
    const handled = await handleAdminForward(ctx);
    if (handled) return;
  }

  // Admin handlers
  if (ctx.session.user.role === 'admin') {
    const handled = await handleAdmin(ctx);
    if (handled) return;

    // If admin sends unknown text, show admin menu
    if (!ctx.session.state || ctx.session.state === 'admin:main') {
      await sendMain(ctx);
    }
    return;
  }

  // User handlers
  if (ctx.session.user.role === 'user') {
    const handled = await handleUser(ctx);
    if (handled) return;

    // Unknown text — show user menu
    if (!ctx.session.state || ctx.session.state === 'user:main') {
      await sendUserMain(ctx);
    }
    return;
  }
});

// ==================== Error handling ==================== //

bot.catch((err) => {
  console.error('[bot] Error:', err.message);
});

// ==================== Start ==================== //

async function main() {
  console.log('Starting bot...');

  // Start polling
  await bot.start({
    allowed_updates: ['message', 'my_chat_member', 'chat_member'],
    onStart: (me) => {
      console.log(`Bot started: @${me.username} (id=${me.id})`);
    },
  });
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  bot.stop();
  process.exit();
});

process.on('SIGTERM', () => {
  console.log('\nShutting down...');
  bot.stop();
  process.exit();
});
