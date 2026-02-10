/**
 * Admin handlers — users, topics, chats, tickets management.
 * Uses session.state to track where admin is in the menu.
 * Admin does NOT create tickets.
 */
const { stmts, getOrCreateUser, addUserByUsername, addOrUpdateChat } = require('../database');
const kb = require('../keyboards');

function isAdmin(ctx) {
  return ctx.session?.user?.role === 'admin';
}

function sendMain(ctx) {
  ctx.session.state = 'admin:main';
  ctx.session.step = null;
  ctx.session.draft = {};
  return ctx.reply('🛠 <b>Адмін-панель</b>\n\nОберіть розділ:', {
    parse_mode: 'HTML',
    reply_markup: kb.ADMIN_MAIN,
  });
}

// ==================== Router ==================== //

async function handleAdmin(ctx) {
  if (!isAdmin(ctx)) return false; // not handled

  const text = ctx.message?.text?.trim();
  if (!text) return false;

  const state = ctx.session.state || 'admin:main';
  const step = ctx.session.step;

  // ---- Global nav ---- //
  if (text === '◀️ Головне меню') { await sendMain(ctx); return true; }

  // ---- State machine ---- //
  switch (state) {
    case 'admin:main':
      return handleMainMenu(ctx, text);

    // -- Users -- //
    case 'admin:users':
      return handleUsersMenu(ctx, text);
    case 'admin:users:add':
      return handleAddUser(ctx, text);
    case 'admin:users:add:role':
      return handleAddUserRole(ctx, text);
    case 'admin:users:add:name':
      return handleAddUserName(ctx, text);
    case 'admin:users:import':
      return handleBulkImportUsers(ctx, text);
    case 'admin:users:detail':
      return handleUserDetail(ctx, text);
    case 'admin:users:delete':
      return handleDeleteUser(ctx, text);
    case 'admin:users:setname':
      return handleSetDisplayName(ctx, text);

    // -- Topics -- //
    case 'admin:topics':
      return handleTopicsMenu(ctx, text);
    case 'admin:topics:add:name':
      return handleTopicName(ctx, text);
    case 'admin:topics:add:desc':
      return handleTopicDesc(ctx, text);
    case 'admin:topics:detail':
      return handleTopicDetail(ctx, text);
    case 'admin:topics:assign:chat':
      return handleTopicAssignChat(ctx, text);
    case 'admin:topics:add:dev':
      return handleTopicAddDev(ctx, text);
    case 'admin:topics:remove:dev':
      return handleTopicRemoveDev(ctx, text);
    case 'admin:topics:edit:desc':
      return handleTopicEditDesc(ctx, text);

    // -- Chats -- //
    case 'admin:chats':
      return handleChatsMenu(ctx, text);
    case 'admin:chats:detail':
      return handleChatDetail(ctx, text);

    // -- Tickets -- //
    case 'admin:tickets':
      return handleTicketsMenu(ctx, text);
    case 'admin:tickets:filter:user':
      return handleTicketFilterUser(ctx, text);
    case 'admin:tickets:filter:dev':
      return handleTicketFilterDev(ctx, text);
    case 'admin:tickets:list':
      return handleTicketsListNav(ctx, text);
    case 'admin:tickets:detail':
      return handleTicketDetail(ctx, text);

    default:
      return false;
  }
}

// Handle forwarded messages for adding users
async function handleAdminForward(ctx) {
  if (!isAdmin(ctx)) return false;
  if (ctx.session.state !== 'admin:users:add') return false;

  const fwd = ctx.message?.forward_from;
  if (!fwd) {
    await ctx.reply('Не вдалося визначити користувача. Перешліть повідомлення від нього або введіть @username.');
    return true;
  }

  ctx.session.draft.newUserTgId = fwd.id;
  ctx.session.draft.newUserUsername = fwd.username || null;
  ctx.session.draft.newUserName = [fwd.first_name, fwd.last_name].filter(Boolean).join(' ') || null;
  ctx.session.state = 'admin:users:add:role';
  await ctx.reply(
    `Знайдено: <b>${fwd.first_name || '—'}</b> (@${fwd.username || '—'})\nID: <code>${fwd.id}</code>\n\nОберіть роль:`,
    { parse_mode: 'HTML', reply_markup: kb.ROLE_KB }
  );
  return true;
}

// ==================== Main Menu ==================== //

async function handleMainMenu(ctx, text) {
  switch (text) {
    case '👥 Користувачі':
      ctx.session.state = 'admin:users';
      await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
      return true;
    case '📂 Теми':
      ctx.session.state = 'admin:topics';
      await ctx.reply('📂 <b>Теми</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TOPICS });
      return true;
    case '💬 Чати':
      ctx.session.state = 'admin:chats';
      await ctx.reply('💬 <b>Чати</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_CHATS });
      return true;
    case '📊 Тікети':
      ctx.session.state = 'admin:tickets';
      await ctx.reply('📊 <b>Тікети</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TICKETS });
      return true;
    default:
      return false;
  }
}

// ==================== Users ==================== //

async function handleUsersMenu(ctx, text) {
  if (text === '◀️ Назад') { await sendMain(ctx); return true; }

  if (text === '➕ Додати користувача') {
    ctx.session.state = 'admin:users:add';
    ctx.session.draft = {};
    await ctx.reply(
      'Введіть @username користувача або перешліть його повідомлення:',
      { reply_markup: kb.CANCEL_KB }
    );
    return true;
  }

  if (text === '📥 Імпортувати юзерів') {
    ctx.session.state = 'admin:users:import';
    ctx.session.draft = {};
    await ctx.reply(
      '📥 <b>Масовий імпорт юзерів</b>\n\n' +
      'Введіть юзерів у форматі (один на рядок):\n\n' +
      '<code>123456:John Doe</code>\n' +
      '<code>@username:Display Name</code>\n\n' +
      'Або просто ID/username без імені.\n\n' +
      'Приклад:\n' +
      '<code>123456\n' +
      '@alice:Alice Johnson\n' +
      '789012:Bob</code>',
      { parse_mode: 'HTML', reply_markup: kb.CANCEL_KB }
    );
    return true;
  }

  if (text === '📋 Список користувачів') {
    const users = stmts.listUsers.all();
    if (!users.length) {
      await ctx.reply('Список порожній.');
      return true;
    }
    // Show list, clicking a user shows detail
    const lines = users.map(u => {
      const icon = u.role === 'admin' ? '👑' : '👤';
      const tgId = u.telegram_id ? `ID: ${u.telegram_id}` : '⏳ очікує /start';
      const name = u.display_name || u.first_name || '—';
      return `${icon} ${name} (@${u.username || '—'}) — ${tgId}`;
    });
    // Build dynamic keyboard with usernames
    const kbList = new (require('grammy').Keyboard)();
    kbList.text('◀️ Назад').row();
    for (const u of users) {
      const name = u.display_name || u.first_name || '';
      const label = `${u.role === 'admin' ? '👑' : '👤'} @${u.username || u.telegram_id || u.id}${name ? ` (${name})` : ''}`;
      kbList.text(label).row();
    }
    kbList.resized().persistent();

    ctx.session.state = 'admin:users:detail';
    ctx.session.draft.usersList = users;
    await ctx.reply(lines.join('\n'), { reply_markup: kbList });
    return true;
  }

  if (text === '❌ Скасувати') {
    ctx.session.state = 'admin:users';
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  return false;
}

async function handleAddUser(ctx, text) {
  if (text === '❌ Скасувати') {
    ctx.session.state = 'admin:users';
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  // Text input: @username
  const username = text.replace(/^@/, '').trim();
  if (!username || username.length < 2) {
    await ctx.reply('⚠️ Введіть коректний @username.');
    return true;
  }

  ctx.session.draft.newUserUsername = username;
  ctx.session.draft.newUserTgId = null;
  ctx.session.state = 'admin:users:add:role';
  await ctx.reply(`Додаємо: @${username}\n\nОберіть роль:`, { reply_markup: kb.ROLE_KB });
  return true;
}

async function handleAddUserRole(ctx, text) {
  if (text === '❌ Скасувати') {
    ctx.session.state = 'admin:users';
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  let role;
  if (text === '👤 User') role = 'user';
  else if (text === '👑 Admin') role = 'admin';
  else { await ctx.reply('Оберіть роль кнопкою.'); return true; }

  ctx.session.draft.newUserRole = role;
  ctx.session.state = 'admin:users:add:name';

  const skipKb = new (require('grammy').Keyboard)()
    .text('⏩ Пропустити').row()
    .text('❌ Скасувати').row()
    .resized().persistent();

  const draft = ctx.session.draft;
  const hint = draft.newUserName ? `\nІмʼя з профілю: <b>${draft.newUserName}</b>` : '';
  await ctx.reply(
    `Введіть відображуване імʼя для @${draft.newUserUsername || draft.newUserTgId || '—'}:${hint}\n\n` +
    `(або натисніть «⏩ Пропустити» — імʼя буде взято автоматично)`,
    { parse_mode: 'HTML', reply_markup: skipKb }
  );
  return true;
}

async function handleAddUserName(ctx, text) {
  if (text === '❌ Скасувати') {
    ctx.session.state = 'admin:users';
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  const draft = ctx.session.draft;
  const role = draft.newUserRole;
  let displayName = null;

  if (text === '⏩ Пропустити') {
    // Auto-resolve name: from TG profile → from username → fallback
    displayName = draft.newUserName || null;
  } else {
    displayName = text.trim();
  }

  // Create user
  let user;
  if (draft.newUserTgId) {
    user = getOrCreateUser(draft.newUserTgId, draft.newUserUsername, draft.newUserName, role);
    stmts.setUserRole.run({ role, telegram_id: draft.newUserTgId });
    console.log(`[admin] User added: ${draft.newUserTgId} (${draft.newUserUsername}) as ${role}`);
  } else {
    user = addUserByUsername(draft.newUserUsername, role);
    console.log(`[admin] Placeholder user added: ${draft.newUserUsername} as ${role}`);
  }

  // Set display name
  if (user && displayName) {
    stmts.setDisplayName.run({ display_name: displayName, id: user.id });
  } else if (user && !displayName && !user.first_name) {
    // No name at all — generate from username
    const fallback = draft.newUserUsername || `User ${user.id}`;
    stmts.setDisplayName.run({ display_name: fallback, id: user.id });
    displayName = fallback;
  }

  ctx.session.state = 'admin:users';
  ctx.session.draft = {};
  const label = draft.newUserTgId
    ? `${displayName || draft.newUserName || '—'} (@${draft.newUserUsername || '—'}) [${draft.newUserTgId}]`
    : `@${draft.newUserUsername} (${displayName || '—'})`;
  await ctx.reply(
    `✅ Користувач ${label} додано з роллю <b>${role}</b>.\n` +
    (draft.newUserTgId ? '' : '⏳ Він зʼявиться в системі коли натисне /start.'),
    { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS }
  );
  return true;
}

async function handleBulkImportUsers(ctx, text) {
  if (text === '❌ Скасувати') {
    ctx.session.state = 'admin:users';
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  const lines = text.split('\n').filter(l => l.trim());
  let added = 0, updated = 0, failed = 0;
  const results = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      let userId, displayName, username, role = 'user';

      // Parse: "id:name" or "@username:name" or just "id" or "@username"
      if (trimmed.includes(':')) {
        const [id_part, name_part] = trimmed.split(':').map(s => s.trim());
        displayName = name_part || null;
        if (id_part.startsWith('@')) {
          username = id_part.replace(/^@/, '').toLowerCase();
          userId = null;
        } else if (/^\d+$/.test(id_part)) {
          userId = parseInt(id_part);
          username = null;
        } else {
          results.push(`❌ ${trimmed} (невалідний формат)`);
          failed++;
          continue;
        }
      } else {
        displayName = null;
        if (trimmed.startsWith('@')) {
          username = trimmed.replace(/^@/, '').toLowerCase();
          userId = null;
        } else if (/^\d+$/.test(trimmed)) {
          userId = parseInt(trimmed);
          username = null;
        } else {
          results.push(`❌ ${trimmed} (невалідний формат)`);
          failed++;
          continue;
        }
      }

      // Add or update user
      if (userId) {
        // By telegram ID
        let user = stmts.getUserByTgId.get(userId);
        if (user) {
          if (displayName) {
            stmts.setDisplayName.run({ display_name: displayName, id: user.id });
            results.push(`✏️ #${userId} → ${displayName} (оновлено)`);
            updated++;
          } else {
            results.push(`✅ #${userId} (вже є)`);
          }
        } else {
          stmts.insertUser.run({ telegram_id: userId, username: null, first_name: null, role });
          if (displayName) {
            const newUser = stmts.getUserByTgId.get(userId);
            stmts.setDisplayName.run({ display_name: displayName, id: newUser.id });
          }
          results.push(`✅ #${userId} (додано)`);
          added++;
        }
      } else if (username) {
        // By username
        let user = stmts.getUserByUsername.get(username);
        if (user) {
          if (displayName) {
            stmts.setDisplayName.run({ display_name: displayName, id: user.id });
            results.push(`✏️ @${username} → ${displayName} (оновлено)`);
            updated++;
          } else {
            results.push(`✅ @${username} (вже є)`);
          }
        } else {
          stmts.insertUser.run({ telegram_id: null, username, first_name: null, role });
          if (displayName) {
            const newUser = stmts.getUserByUsername.get(username);
            stmts.setDisplayName.run({ display_name: displayName, id: newUser.id });
          }
          results.push(`✅ @${username} (додано)`);
          added++;
        }
      }
    } catch (e) {
      results.push(`❌ ${trimmed} (${e.message})`);
      failed++;
    }
  }

  const summary = `📥 <b>Імпорт завершено</b>\n\n✅ Додано: <b>${added}</b>\n✏️ Оновлено: <b>${updated}</b>\n❌ Помилок: <b>${failed}</b>`;
  const resultText = results.length > 0 ? `\n\n${results.slice(0, 20).join('\n')}` + (results.length > 20 ? `\n... і ще ${results.length - 20}` : '') : '';

  console.log(`[admin] Bulk import: ${added} added, ${updated} updated, ${failed} failed`);

  ctx.session.state = 'admin:users';
  await ctx.reply(summary + resultText, { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
  return true;
}

async function handleUserDetail(ctx, text) {
  if (text === '◀️ Назад') {
    ctx.session.state = 'admin:users';
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  // Toggle role buttons
  if (text === '⬆️ Зробити адміном' || text === '⬇️ Зняти адміна') {
    const user = ctx.session.draft?.detailUser;
    if (user) {
      const newRole = text.startsWith('⬆️') ? 'admin' : 'user';
      if (user.telegram_id) {
        stmts.setUserRole.run({ role: newRole, telegram_id: user.telegram_id });
      } else {
        stmts.setUserRoleById.run({ role: newRole, id: user.id });
      }
      await ctx.reply(`✅ Роль змінено на <b>${newRole}</b>.`, { parse_mode: 'HTML' });
    }
    ctx.session.state = 'admin:users';
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  // Delete button
  if (text === '🗑 Видалити') {
    const user = ctx.session.draft?.detailUser;
    if (!user) return false;
    ctx.session.state = 'admin:users:delete';
    const confirmKb = new (require('grammy').Keyboard)()
      .text('✅ Так, видалити').text('❌ Ні, скасувати').row()
      .resized().persistent();
    const name = user.display_name || user.first_name || user.username || '—';
    await ctx.reply(
      `⚠️ <b>Ви впевнені?</b>\n\nВидалити користувача <b>${name}</b> (@${user.username || '—'})?\n\n` +
      `Це також видалить усі його призначення до тем.`,
      { parse_mode: 'HTML', reply_markup: confirmKb }
    );
    return true;
  }

  // Rename button
  if (text === '✏️ Назвати') {
    const user = ctx.session.draft?.detailUser;
    if (!user) return false;
    ctx.session.state = 'admin:users:setname';
    await ctx.reply(
      `Введіть відображуване імʼя для <b>${user.first_name || user.username || '—'}</b>:\n` +
      `(або «-» щоб скинути)`,
      { parse_mode: 'HTML', reply_markup: kb.CANCEL_KB }
    );
    return true;
  }

  // Parse the button text to find user
  const match = text.match(/@(\S+)/);
  if (!match) return false;
  const uname = match[1];

  let user = stmts.getUserByUsername.get(uname);
  if (!user && /^\d+$/.test(uname)) {
    user = stmts.getUserByTgId.get(parseInt(uname));
  }
  if (!user) { await ctx.reply('Користувач не знайдений.'); return true; }

  const icon = user.role === 'admin' ? '👑' : '👤';
  const toggleLabel = user.role === 'admin' ? '⬇️ Зняти адміна' : '⬆️ Зробити адміном';
  const toggleKb = new (require('grammy').Keyboard)()
    .text(toggleLabel).row()
    .text('✏️ Назвати').row()
    .text('🗑 Видалити').row()
    .text('◀️ Назад').row()
    .resized().persistent();

  ctx.session.draft.detailUser = user;
  const displayLabel = user.display_name ? `\nВідображення: <b>${user.display_name}</b>` : '';
  await ctx.reply(
    `${icon} <b>${user.first_name || '—'}</b>\n` +
    `Username: @${user.username || '—'}\n` +
    `Telegram ID: <code>${user.telegram_id || 'очікує /start'}</code>\n` +
    `Роль: ${user.role}` +
    displayLabel,
    { parse_mode: 'HTML', reply_markup: toggleKb }
  );
  return true;
}

async function handleSetDisplayName(ctx, text) {
  if (text === '❌ Скасувати') {
    ctx.session.state = 'admin:users';
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  const user = ctx.session.draft?.detailUser;
  if (!user) { await sendMain(ctx); return true; }

  const displayName = text === '-' ? null : text.trim();
  stmts.setDisplayName.run({ display_name: displayName, id: user.id });
  const label = displayName || '(скинуто)';
  console.log(`[admin] Display name set for user ${user.id}: ${label}`);
  await ctx.reply(
    `✅ Відображуване імʼя для <b>${user.first_name || user.username || '—'}</b> → <b>${label}</b>`,
    { parse_mode: 'HTML' }
  );
  ctx.session.state = 'admin:users';
  await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
  return true;
}

async function handleDeleteUser(ctx, text) {
  if (text === '❌ Ні, скасувати') {
    ctx.session.state = 'admin:users';
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  if (text === '✅ Так, видалити') {
    const user = ctx.session.draft?.detailUser;
    if (!user) { await sendMain(ctx); return true; }

    const name = user.display_name || user.first_name || user.username || '—';
    try {
      stmts.deleteUser.run(user.id);
      console.log(`[admin] User deleted: ${user.id} (${name})`);
      await ctx.reply(
        `🗑 Користувача <b>${name}</b> (@${user.username || '—'}) видалено.`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {
      console.error('[admin] Delete user error:', e.message);
      await ctx.reply(`❌ Помилка видалення: ${e.message}`);
    }

    ctx.session.state = 'admin:users';
    ctx.session.draft = {};
    await ctx.reply('👥 <b>Користувачі</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_USERS });
    return true;
  }

  return false;
}

// ==================== Topics ==================== //

async function handleTopicsMenu(ctx, text) {
  if (text === '◀️ Назад') { await sendMain(ctx); return true; }

  if (text === '➕ Додати тему') {
    ctx.session.state = 'admin:topics:add:name';
    ctx.session.draft = {};
    await ctx.reply('Введіть назву нової теми:', { reply_markup: kb.CANCEL_KB });
    return true;
  }

  if (text === '📋 Список тем') {
    const topics = stmts.listTopicsWithChats.all();
    if (!topics.length) { await ctx.reply('Тем ще немає.'); return true; }

    const lines = topics.map(t => {
      const chatInfo = t.chat_title ? ` → 💬 ${t.chat_title}` : ' ⚠️ без чату';
      return `📂 ${t.name}${chatInfo}`;
    });
    const kbList = new (require('grammy').Keyboard)();
    kbList.text('◀️ Назад').row();
    for (const t of topics) kbList.text(`📂 ${t.name}`).row();
    kbList.resized().persistent();

    ctx.session.state = 'admin:topics:detail';
    await ctx.reply(lines.join('\n'), { reply_markup: kbList });
    return true;
  }

  if (text === '❌ Скасувати') {
    ctx.session.state = 'admin:topics';
    await ctx.reply('📂 <b>Теми</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TOPICS });
    return true;
  }

  return false;
}

async function handleTopicName(ctx, text) {
  if (text === '❌ Скасувати') {
    ctx.session.state = 'admin:topics';
    await ctx.reply('📂 <b>Теми</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TOPICS });
    return true;
  }
  if (text.length < 2) { await ctx.reply('⚠️ Занадто коротка назва.'); return true; }

  ctx.session.draft.topicName = text;
  ctx.session.state = 'admin:topics:add:desc';
  await ctx.reply('Введіть опис теми (або «-» щоб пропустити):', { reply_markup: kb.CANCEL_KB });
  return true;
}

async function handleTopicDesc(ctx, text) {
  if (text === '❌ Скасувати') {
    ctx.session.state = 'admin:topics';
    await ctx.reply('📂 <b>Теми</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TOPICS });
    return true;
  }

  const desc = text === '-' ? null : text;
  const topicName = ctx.session.draft.topicName;
  try {
    stmts.insertTopic.run({ name: topicName, description: desc });
    console.log(`[admin] Topic created: ${topicName}`);
  } catch (e) {
    console.error(`[admin] Topic creation failed: ${e.message}`);
    await ctx.reply('⚠️ Тема з такою назвою вже існує.');
    ctx.session.state = 'admin:topics';
    return true;
  }

  ctx.session.draft = {};
  await ctx.reply(`✅ Тему <b>${topicName}</b> створено!\n\nТепер призначте чат та розробників:`, { parse_mode: 'HTML' });
  const newTopic = stmts.listTopics.all().find(t => t.name === topicName);
  if (newTopic) return showTopicDetail(ctx, newTopic.id);
  ctx.session.state = 'admin:topics';
  return true;
}

async function handleTopicDetail(ctx, text) {
  if (text === '◀️ Назад') {
    ctx.session.state = 'admin:topics';
    await ctx.reply('📂 <b>Теми</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TOPICS });
    return true;
  }

  // Delete topic button
  if (text.startsWith('🗑 Видалити')) {
    const topic = ctx.session.draft?.detailTopic;
    if (topic) {
      stmts.removeAllTopicDevs.run(topic.id);
      stmts.deleteTopic.run(topic.id);
      await ctx.reply(`✅ Тему <b>${topic.name}</b> видалено.`, { parse_mode: 'HTML' });
    }
    ctx.session.state = 'admin:topics';
    await ctx.reply('📂 <b>Теми</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TOPICS });
    return true;
  }

  // Assign chat button
  if (text === '💬 Призначити чат') {
    const chats = stmts.listActiveChats.all();
    if (!chats.length) {
      await ctx.reply('⚠️ Немає доступних чатів. Спочатку додайте бота в групу.');
      return true;
    }
    const kbChats = new (require('grammy').Keyboard)();
    kbChats.text('❌ Скасувати').text('🚫 Без чату').row();
    for (const c of chats) kbChats.text(`💬 ${c.title || c.chat_id}`).row();
    kbChats.resized().persistent();
    ctx.session.state = 'admin:topics:assign:chat';
    await ctx.reply('Оберіть чат для теми:', { reply_markup: kbChats });
    return true;
  }

  // Add developer button
  if (text === '👨‍💻 Додати розробника') {
    const users = stmts.listUsers.all();
    if (!users.length) { await ctx.reply('⚠️ Немає користувачів.'); return true; }
    const topicDevs = stmts.listTopicDevs.all(ctx.session.draft.detailTopic.id);
    const devIds = new Set(topicDevs.map(d => d.id));
    const available = users.filter(u => !devIds.has(u.id));
    if (!available.length) { await ctx.reply('Всі користувачі вже призначені.'); return true; }
    const kbUsers = new (require('grammy').Keyboard)();
    kbUsers.text('❌ Скасувати').row();
    for (const u of available) {
      kbUsers.text(`👤 @${u.username || u.telegram_id || u.id} (${u.display_name || u.first_name || '—'})`).row();
    }
    kbUsers.resized().persistent();
    ctx.session.state = 'admin:topics:add:dev';
    await ctx.reply('Оберіть розробника для теми:', { reply_markup: kbUsers });
    return true;
  }

  // Remove developer button
  if (text === '👨‍💻 Прибрати розробника') {
    const devs = stmts.listTopicDevs.all(ctx.session.draft.detailTopic.id);
    if (!devs.length) { await ctx.reply('Розробників не призначено.'); return true; }
    const kbDevs = new (require('grammy').Keyboard)();
    kbDevs.text('❌ Скасувати').row();
    for (const d of devs) {
      kbDevs.text(`🗑 @${d.username || d.telegram_id || d.id} (${d.display_name || d.first_name || '—'})`).row();
    }
    kbDevs.resized().persistent();
    ctx.session.state = 'admin:topics:remove:dev';
    await ctx.reply('Оберіть розробника для видалення:', { reply_markup: kbDevs });
    return true;
  }

  // Edit description button
  if (text === '✏️ Змінити опис') {
    ctx.session.state = 'admin:topics:edit:desc';
    const currentDesc = ctx.session.draft?.detailTopic?.description;
    await ctx.reply(
      `Поточний опис: ${currentDesc || '(без опису)'}\n\nВведіть новий опис (або «-» щоб очистити):`,
      { reply_markup: kb.CANCEL_KB }
    );
    return true;
  }

  // Select topic from list — show detail
  const name = text.replace(/^📂\s*/, '');
  const topics = stmts.listTopics.all();
  const topic = topics.find(t => t.name === name);
  if (!topic) { await ctx.reply('Тема не знайдена.'); return true; }

  return showTopicDetail(ctx, topic.id);
}

async function showTopicDetail(ctx, topicId) {
  const topic = stmts.getTopicWithChat.get(topicId);
  if (!topic) { await ctx.reply('Тема не знайдена.'); return true; }
  const devs = stmts.listTopicDevs.all(topicId);
  ctx.session.draft.detailTopic = topic;
  ctx.session.state = 'admin:topics:detail';

  const chatInfo = topic.chat_title ? topic.chat_title : '⚠️ не призначено';
  const devInfo = devs.length
    ? devs.map(d => `  @${d.username || d.telegram_id || d.id} (${d.display_name || d.first_name || '—'})`).join('\n')
    : '  не призначено';

  const detailKb = new (require('grammy').Keyboard)();
  detailKb.text('✏️ Змінити опис').row();
  detailKb.text('💬 Призначити чат').row();
  detailKb.text('👨‍💻 Додати розробника').row();
  if (devs.length) detailKb.text('👨‍💻 Прибрати розробника').row();
  detailKb.text(`🗑 Видалити "${topic.name}"`).row();
  detailKb.text('◀️ Назад').row();
  detailKb.resized().persistent();

  await ctx.reply(
    `📂 <b>${topic.name}</b>\n` +
    `📝 ${topic.description || '(без опису)'}\n\n` +
    `💬 Чат: ${chatInfo}\n` +
    `👨‍💻 Розробники:\n${devInfo}`,
    { parse_mode: 'HTML', reply_markup: detailKb }
  );
  return true;
}

async function handleTopicEditDesc(ctx, text) {
  if (text === '❌ Скасувати') {
    return showTopicDetail(ctx, ctx.session.draft.detailTopic.id);
  }
  const desc = text === '-' ? null : text;
  const topicId = ctx.session.draft.detailTopic.id;
  stmts.updateTopicDesc.run({ description: desc, id: topicId });
  await ctx.reply(desc ? `✅ Опис оновлено.` : `✅ Опис очищено.`);
  return showTopicDetail(ctx, topicId);
}

async function handleTopicAssignChat(ctx, text) {
  if (text === '❌ Скасувати') {
    return showTopicDetail(ctx, ctx.session.draft.detailTopic.id);
  }
  if (text === '🚫 Без чату') {
    stmts.setTopicChat.run({ chat_id: null, id: ctx.session.draft.detailTopic.id });
    await ctx.reply('✅ Чат знято з теми.');
    return showTopicDetail(ctx, ctx.session.draft.detailTopic.id);
  }
  const cleanTitle = text.replace(/^💬\s*/, '');
  const chats = stmts.listActiveChats.all();
  const chat = chats.find(c => (c.title || String(c.chat_id)) === cleanTitle);
  if (!chat) { await ctx.reply('⚠️ Оберіть чат з клавіатури.'); return true; }

  stmts.setTopicChat.run({ chat_id: chat.id, id: ctx.session.draft.detailTopic.id });
  console.log(`[admin] Chat assigned to topic ${ctx.session.draft.detailTopic.id}: ${chat.title || chat.chat_id}`);
  await ctx.reply(`✅ Чат <b>${chat.title || chat.chat_id}</b> призначено для теми.`, { parse_mode: 'HTML' });
  return showTopicDetail(ctx, ctx.session.draft.detailTopic.id);
}

async function handleTopicAddDev(ctx, text) {
  if (text === '❌ Скасувати') {
    return showTopicDetail(ctx, ctx.session.draft.detailTopic.id);
  }
  const match = text.match(/@(\S+)/);
  if (!match) { await ctx.reply('⚠️ Оберіть розробника з клавіатури.'); return true; }
  const uname = match[1];
  let user = stmts.getUserByUsername.get(uname);
  if (!user && /^\d+$/.test(uname)) user = stmts.getUserByTgId.get(parseInt(uname));
  if (!user) { await ctx.reply('Користувач не знайдений.'); return true; }

  stmts.addTopicDev.run({ topic_id: ctx.session.draft.detailTopic.id, user_id: user.id });
  console.log(`[admin] Dev added to topic ${ctx.session.draft.detailTopic.id}: ${user.username || user.id}`);
  const userLabel = `@${user.username || user.telegram_id || user.id} (${user.display_name || user.first_name || '—'})`;
  await ctx.reply(`✅ <b>${userLabel}</b> додано як розробника.`, { parse_mode: 'HTML' });
  return showTopicDetail(ctx, ctx.session.draft.detailTopic.id);
}

async function handleTopicRemoveDev(ctx, text) {
  if (text === '❌ Скасувати') {
    return showTopicDetail(ctx, ctx.session.draft.detailTopic.id);
  }
  const match = text.match(/@(\S+)/);
  if (!match) { await ctx.reply('⚠️ Оберіть розробника з клавіатури.'); return true; }
  const uname = match[1];
  let user = stmts.getUserByUsername.get(uname);
  if (!user && /^\d+$/.test(uname)) user = stmts.getUserByTgId.get(parseInt(uname));
  if (!user) { await ctx.reply('Розробник не знайдений.'); return true; }

  stmts.removeTopicDev.run({ topic_id: ctx.session.draft.detailTopic.id, user_id: user.id });
  console.log(`[admin] Dev removed from topic ${ctx.session.draft.detailTopic.id}: ${user.username || user.id}`);
  const userLabel = `@${user.username || user.telegram_id || user.id} (${user.display_name || user.first_name || '—'})`;
  await ctx.reply(`✅ <b>${userLabel}</b> прибрано.`, { parse_mode: 'HTML' });
  return showTopicDetail(ctx, ctx.session.draft.detailTopic.id);
}

// ==================== Chats ==================== //

async function handleChatsMenu(ctx, text) {
  if (text === '◀️ Назад') { await sendMain(ctx); return true; }

  if (text === '🔄 Оновити список чатів') {
    await ctx.reply(
      'ℹ️ Додайте бота в групу як адміністратора — він автоматично зареєструє чат.',
      { reply_markup: kb.ADMIN_CHATS }
    );
    return true;
  }

  if (text === '📋 Список чатів') {
    const chats = stmts.listAllChats.all();
    if (!chats.length) { await ctx.reply('Чатів ще немає. Додайте бота в групу.'); return true; }

    const lines = chats.map(c => {
      const st = c.is_active ? '✅' : '❌';
      return `${st} ${c.title || c.chat_id}`;
    });

    const kbList = new (require('grammy').Keyboard)();
    kbList.text('◀️ Назад').row();
    for (const c of chats) {
      kbList.text(`${c.is_active ? '✅' : '❌'} ${c.title || c.chat_id}`).row();
    }
    kbList.resized().persistent();

    ctx.session.state = 'admin:chats:detail';
    await ctx.reply(lines.join('\n'), { reply_markup: kbList });
    return true;
  }

  return false;
}

async function handleChatDetail(ctx, text) {
  if (text === '◀️ Назад') {
    ctx.session.state = 'admin:chats';
    await ctx.reply('💬 <b>Чати</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_CHATS });
    return true;
  }

  // Toggle activate/deactivate
  if (text === '✅ Активувати' || text === '❌ Деактивувати') {
    const chat = ctx.session.draft?.detailChat;
    if (chat) {
      if (text === '✅ Активувати') {
        stmts.activateChat.run(chat.chat_id);
        await ctx.reply(`✅ Чат <b>${chat.title || chat.chat_id}</b> активовано.`, { parse_mode: 'HTML' });
      } else {
        stmts.deactivateChat.run(chat.chat_id);
        await ctx.reply(`❌ Чат <b>${chat.title || chat.chat_id}</b> деактивовано.`, { parse_mode: 'HTML' });
      }
    }
    ctx.session.state = 'admin:chats';
    await ctx.reply('💬 <b>Чати</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_CHATS });
    return true;
  }

  // Parse chat title from button
  const cleanTitle = text.replace(/^[✅❌]\s*/, '');
  const chats = stmts.listAllChats.all();
  const chat = chats.find(c => (c.title || String(c.chat_id)) === cleanTitle);
  if (!chat) { await ctx.reply('Чат не знайдений.'); return true; }

  const toggleLabel = chat.is_active ? '❌ Деактивувати' : '✅ Активувати';
  const kbDetail = new (require('grammy').Keyboard)()
    .text(toggleLabel).row()
    .text('◀️ Назад').row()
    .resized().persistent();

  ctx.session.draft.detailChat = chat;
  await ctx.reply(
    `💬 <b>${chat.title || 'Без назви'}</b>\nChat ID: <code>${chat.chat_id}</code>\nСтатус: ${chat.is_active ? '✅ Активний' : '❌ Неактивний'}`,
    { parse_mode: 'HTML', reply_markup: kbDetail }
  );
  return true;
}

// ==================== Tickets (admin) ==================== //

/** Show a list of tickets with buttons and navigate to detail */
async function showTicketList(ctx, tickets, headerText) {
  if (!tickets.length) {
    await ctx.reply(`${headerText}\n\nТікетів не знайдено.`, { parse_mode: 'HTML', reply_markup: kb.ADMIN_TICKETS });
    ctx.session.state = 'admin:tickets';
    return true;
  }
  const emoji = { open: '🔴', in_progress: '🟡', closed: '🟢' };
  const lines = tickets.map(t =>
    `${emoji[t.status] || '⚪'} #${t.id} — ${t.title.substring(0, 40)} (${t.author_display_name || t.author_first_name || '—'})`
  );
  const kbList = new (require('grammy').Keyboard)();
  kbList.text('◀️ Назад').row();
  for (const t of tickets) {
    kbList.text(`${emoji[t.status] || '⚪'} #${t.id} ${t.title.substring(0, 30)}`).row();
  }
  kbList.resized().persistent();

  ctx.session.state = 'admin:tickets:list';
  await ctx.reply(`${headerText}\n\n${lines.join('\n')}`, { parse_mode: 'HTML', reply_markup: kbList });
  return true;
}

async function handleTicketsMenu(ctx, text) {
  if (text === '◀️ Назад') { await sendMain(ctx); return true; }

  // Stats
  if (text === '📊 Статистика' || text.includes('Статистика')) {
    const s = stmts.ticketStats.get();
    await ctx.reply(
      `📊 <b>Статистика тікетів</b>\n\n` +
      `📦 Всього: <b>${s.total}</b>\n` +
      `🔴 Відкриті: <b>${s.open_count}</b>\n` +
      `🟡 В роботі: <b>${s.in_progress_count}</b>\n` +
      `🟢 Закриті: <b>${s.closed_count}</b>`,
      { parse_mode: 'HTML', reply_markup: kb.ADMIN_TICKETS }
    );
    return true;
  }

  // All tickets
  if (text === '📋 Всі тікети') {
    const tickets = stmts.listAllTickets.all();
    return showTicketList(ctx, tickets, '📋 <b>Всі тікети</b>');
  }

  // Open tickets
  if (text === '📋 Відкриті тікети') {
    const tickets = stmts.listOpenTickets.all();
    return showTicketList(ctx, tickets, '📋 <b>Відкриті тікети</b>');
  }

  // Filter by status
  if (text === '🔴 Відкриті') {
    return showTicketList(ctx, stmts.listTicketsByStatus.all('open'), '🔴 <b>Відкриті тікети</b>');
  }
  if (text === '🟡 В роботі') {
    return showTicketList(ctx, stmts.listTicketsByStatus.all('in_progress'), '🟡 <b>Тікети в роботі</b>');
  }
  if (text === '🟢 Закриті') {
    return showTicketList(ctx, stmts.listTicketsByStatus.all('closed'), '🟢 <b>Закриті тікети</b>');
  }

  // Filter by user
  if (text === '👤 По юзеру') {
    const users = stmts.listUsers.all().filter(u => u.role === 'user');
    if (!users.length) { await ctx.reply('Немає юзерів.', { reply_markup: kb.ADMIN_TICKETS }); return true; }
    const kbUsers = new (require('grammy').Keyboard)();
    kbUsers.text('◀️ Назад').row();
    for (const u of users) {
      const name = u.display_name || u.first_name || u.username || String(u.id);
      kbUsers.text(`👤 ${name}`).row();
    }
    kbUsers.resized().persistent();
    ctx.session.state = 'admin:tickets:filter:user';
    ctx.session.draft.filterUsers = users;
    await ctx.reply('Оберіть юзера:', { reply_markup: kbUsers });
    return true;
  }

  // Filter by developer
  if (text === '👨‍💻 По розробнику') {
    const allDevs = stmts.listUsers.all();
    // Get unique developers assigned to at least one topic
    const devIds = new Set();
    const topics = stmts.listTopics.all();
    for (const topic of topics) {
      const devs = stmts.listTopicDevs.all(topic.id);
      for (const d of devs) devIds.add(d.id);
    }
    const devUsers = allDevs.filter(u => devIds.has(u.id));
    if (!devUsers.length) { await ctx.reply('Немає розробників, призначених до тем.', { reply_markup: kb.ADMIN_TICKETS }); return true; }
    const kbDevs = new (require('grammy').Keyboard)();
    kbDevs.text('◀️ Назад').row();
    for (const u of devUsers) {
      const name = u.display_name || u.first_name || u.username || String(u.id);
      kbDevs.text(`👨‍💻 ${name}`).row();
    }
    kbDevs.resized().persistent();
    ctx.session.state = 'admin:tickets:filter:dev';
    ctx.session.draft.filterDevs = devUsers;
    await ctx.reply('Оберіть розробника:', { reply_markup: kbDevs });
    return true;
  }

  return false;
}

async function handleTicketFilterUser(ctx, text) {
  if (text === '◀️ Назад') {
    ctx.session.state = 'admin:tickets';
    await ctx.reply('📊 <b>Тікети</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TICKETS });
    return true;
  }
  const cleanName = text.replace(/^👤\s*/, '');
  const users = ctx.session.draft?.filterUsers || [];
  const user = users.find(u => (u.display_name || u.first_name || u.username || String(u.id)) === cleanName);
  if (!user) { await ctx.reply('⚠️ Оберіть юзера з клавіатури.'); return true; }

  const tickets = stmts.listTicketsByAuthor.all({ author_id: user.id });
  const displayName = user.display_name || user.first_name || user.username || '—';
  return showTicketList(ctx, tickets, `👤 <b>Тікети від ${displayName}</b>`);
}

async function handleTicketFilterDev(ctx, text) {
  if (text === '◀️ Назад') {
    ctx.session.state = 'admin:tickets';
    await ctx.reply('📊 <b>Тікети</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TICKETS });
    return true;
  }
  const cleanName = text.replace(/^👨‍💻\s*/, '');
  const devs = ctx.session.draft?.filterDevs || [];
  const dev = devs.find(u => (u.display_name || u.first_name || u.username || String(u.id)) === cleanName);
  if (!dev) { await ctx.reply('⚠️ Оберіть розробника з клавіатури.'); return true; }

  const tickets = stmts.listTicketsByDev.all({ dev_id: dev.id });
  const displayName = dev.display_name || dev.first_name || dev.username || '—';
  return showTicketList(ctx, tickets, `👨‍💻 <b>Тікети розробника ${displayName}</b>`);
}

async function handleTicketsListNav(ctx, text) {
  if (text === '◀️ Назад') {
    ctx.session.state = 'admin:tickets';
    await ctx.reply('📊 <b>Тікети</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TICKETS });
    return true;
  }
  // Parse ticket id and show detail
  const match = text.match(/#(\d+)/);
  if (!match) return false;
  const ticketId = parseInt(match[1]);
  return showAdminTicketDetail(ctx, ticketId);
}

async function showAdminTicketDetail(ctx, ticketId) {
  const ticket = stmts.getTicket.get(ticketId);
  if (!ticket) { await ctx.reply('Тікет не знайдений.'); return true; }

  ctx.session.draft.detailTicket = ticket;
  ctx.session.state = 'admin:tickets:detail';
  const emoji = { open: '🔴', in_progress: '🟡', closed: '🟢' };

  // Build ticket history
  const messages = stmts.listTicketMessages.all(ticket.id);
  let historyText = '';
  if (messages.length) {
    const historyLines = messages.map(m => {
      const name = m.display_name || m.first_name || m.username || 'Невідомий';
      const time = m.created_at ? m.created_at.substring(11, 16) : '';
      return `  ${time} <b>${name}</b>: ${m.text || '[медіа]'}`;
    });
    historyText = `\n\n💬 <b>Історія повідомлень:</b>\n${historyLines.join('\n')}`;
  }

  const actions = new (require('grammy').Keyboard)();
  if (ticket.status !== 'closed') actions.text('🔒 Закрити тікет').row();
  if (ticket.status === 'open') actions.text('🔧 В роботу').row();
  actions.text('◀️ Назад').row();
  actions.resized().persistent();

  const chatIdStr = ticket.target_chat_id ? String(ticket.target_chat_id) : null;
  const chatIdClean = chatIdStr
    ? (chatIdStr.startsWith('-100') ? chatIdStr.slice(4) : chatIdStr.replace(/^-/, ''))
    : null;
  const chatLink = chatIdClean && ticket.chat_message_id
    ? `https://t.me/c/${chatIdClean}/${ticket.chat_message_id}`
    : null;
  const topicLine = chatLink
    ? `📂 Тема: <a href="${chatLink}">${ticket.topic_name || '—'}</a>`
    : `📂 Тема: ${ticket.topic_name || '—'}`;

  await ctx.reply(
    `${emoji[ticket.status] || '⚪'} <b>Тікет #${ticket.id}</b> — ${ticket.status}\n\n` +
    `📝 <b>${ticket.title}</b>\n${ticket.description || '—'}\n\n` +
    `${topicLine}\n` +
    `👤 Автор: ${ticket.author_display_name || ticket.author_first_name || '—'} (@${ticket.author_username || '—'})\n` +
    `📅 Створено: ${ticket.created_at}` +
    historyText,
    { parse_mode: 'HTML', reply_markup: actions, disable_web_page_preview: true }
  );
  return true;
}

async function handleTicketDetail(ctx, text) {
  if (text === '◀️ Назад') {
    ctx.session.state = 'admin:tickets';
    await ctx.reply('📊 <b>Тікети</b>', { parse_mode: 'HTML', reply_markup: kb.ADMIN_TICKETS });
    return true;
  }

  // Parse ticket id from button
  const match = text.match(/#(\d+)/);
  if (match) return showAdminTicketDetail(ctx, parseInt(match[1]));

  // Action buttons
  return handleTicketAction(ctx, text);
}

async function handleTicketAction(ctx, text) {
  const ticket = ctx.session.draft?.detailTicket;
  if (!ticket) return false;

  if (text === '🔒 Закрити тікет') {
    stmts.setTicketStatus.run({ status: 'closed', id: ticket.id });
    // Notify user
    try {
      await ctx.api.sendMessage(ticket.author_tg_id,
        `🔒 <b>Тікет #${ticket.id} закрито</b>\n\n${ticket.title}`,
        { parse_mode: 'HTML' }
      );
    } catch (e) { /* user may have blocked bot */ }

    ctx.session.state = 'admin:tickets';
    await ctx.reply(`✅ Тікет #${ticket.id} закрито.`, { reply_markup: kb.ADMIN_TICKETS });
    return true;
  }

  if (text === '🔧 В роботу') {
    stmts.setTicketStatus.run({ status: 'in_progress', id: ticket.id });
    ctx.session.state = 'admin:tickets';
    await ctx.reply(`✅ Тікет #${ticket.id} переведено в роботу.`, { reply_markup: kb.ADMIN_TICKETS });
    return true;
  }

  return false;
}

module.exports = { handleAdmin, handleAdminForward, sendMain, isAdmin };
