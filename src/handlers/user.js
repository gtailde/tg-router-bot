/**
 * User handlers — ticket creation FSM, my tickets, ticket detail.
 * User has a DIFFERENT fixed keyboard. Admin never sees these.
 */
const { Keyboard } = require('grammy');
const { stmts, createTicket } = require('../database');
const kb = require('../keyboards');

function isUser(ctx) {
  return ctx.session?.user?.role === 'user';
}

function sendUserMain(ctx) {
  ctx.session.state = 'user:main';
  ctx.session.step = null;
  ctx.session.draft = {};
  return ctx.reply('📋 <b>Головне меню</b>\n\nОберіть дію:', {
    parse_mode: 'HTML',
    reply_markup: kb.USER_MAIN,
  });
}

async function handleUser(ctx) {
  if (!isUser(ctx)) return false;

  const text = ctx.message?.text?.trim();
  if (!text) return false;

  const state = ctx.session.state || 'user:main';

  // Global nav
  if (text === '❌ Скасувати') {
    await sendUserMain(ctx);
    return true;
  }

  switch (state) {
    case 'user:main':
      return handleUserMain(ctx, text);
    case 'user:ticket:topic':
      return handleChooseTopic(ctx, text);
    case 'user:ticket:title':
      return handleEnterTitle(ctx, text);
    case 'user:ticket:desc':
      return handleEnterDesc(ctx, text);
    case 'user:ticket:confirm':
      return handleConfirm(ctx, text);
    case 'user:tickets:list':
      return handleTicketsList(ctx, text);
    case 'user:tickets:detail':
      return handleTicketDetail(ctx, text);
    default:
      return false;
  }
}

// ==================== Main ==================== //

async function handleUserMain(ctx, text) {
  if (text === '📝 Створити тікет') {
    const topics = stmts.listTopicsWithChats.all().filter(t => t.chat_id);
    if (!topics.length) {
      await ctx.reply('⚠️ Немає доступних тем з призначеними чатами. Зверніться до адміністратора.');
      return true;
    }
    const kbTopics = kb.dynamicListKb(topics, t => `📂 ${t.name}`);
    ctx.session.state = 'user:ticket:topic';
    ctx.session.draft = {};
    await ctx.reply('📂 Оберіть тему тікета:', { reply_markup: kbTopics });
    return true;
  }

  if (text === '📋 Мої тікети') {
    const user = ctx.session.user;
    const tickets = stmts.listUserTickets.all(user.id);
    if (!tickets.length) {
      await ctx.reply('У вас поки немає тікетів.', { reply_markup: kb.USER_MAIN });
      return true;
    }

    const emoji = { open: '🟢', in_progress: '🟡', closed: '🔴' };
    const kbList = new Keyboard();
    kbList.text('◀️ Назад').row();
    for (const t of tickets) {
      kbList.text(`${emoji[t.status] || '⚪'} #${t.id} ${t.title.substring(0, 30)}`).row();
    }
    kbList.resized().persistent();

    const lines = tickets.map(t =>
      `${emoji[t.status] || '⚪'} #${t.id} — ${t.title.substring(0, 40)}`
    );
    ctx.session.state = 'user:tickets:list';
    await ctx.reply('📋 Ваші тікети:\n\n' + lines.join('\n'), { reply_markup: kbList });
    return true;
  }

  return false;
}

// ==================== Ticket FSM ==================== //

async function handleChooseTopic(ctx, text) {
  const name = text.replace(/^📂\s*/, '');
  const topics = stmts.listTopics.all();
  const topic = topics.find(t => t.name === name);
  if (!topic) { await ctx.reply('⚠️ Оберіть тему з клавіатури.'); return true; }

  // Get topic with assigned chat
  const topicFull = stmts.getTopicWithChat.get(topic.id);
  if (!topicFull || !topicFull.chat_id) {
    await ctx.reply('⚠️ Для цієї теми не призначено чат. Зверніться до адміністратора.');
    await sendUserMain(ctx);
    return true;
  }

  ctx.session.draft.topicId = topicFull.id;
  ctx.session.draft.topicName = topicFull.name;
  ctx.session.draft.chatDbId = topicFull.chat_id;
  ctx.session.draft.chatTitle = topicFull.chat_title || '—';

  ctx.session.state = 'user:ticket:title';
  await ctx.reply('📝 Введіть заголовок тікета:', { reply_markup: kb.USER_CANCEL });
  return true;
}

async function handleEnterTitle(ctx, text) {
  if (text.length < 3) {
    await ctx.reply('⚠️ Заголовок занадто короткий (мін. 3 символи).');
    return true;
  }

  ctx.session.draft.title = text;
  ctx.session.state = 'user:ticket:desc';
  await ctx.reply('📄 Опишіть проблему (або «-» щоб пропустити):', { reply_markup: kb.USER_CANCEL });
  return true;
}

async function handleEnterDesc(ctx, text) {
  const desc = text === '-' ? null : text;
  ctx.session.draft.description = desc;

  ctx.session.state = 'user:ticket:confirm';
  const d = ctx.session.draft;
  await ctx.reply(
    `📋 <b>Підтвердіть тікет:</b>\n\n` +
    `📝 Заголовок: <b>${d.title}</b>\n` +
    `📄 Опис: ${d.description || '—'}\n` +
    `📂 Тема: ${d.topicName}`,
    { parse_mode: 'HTML', reply_markup: kb.USER_CONFIRM }
  );
  return true;
}

async function handleConfirm(ctx, text) {
  if (text === '✅ Підтвердити') {
    const d = ctx.session.draft;
    const user = ctx.session.user;

    const ticket = createTicket({
      title: d.title,
      description: d.description,
      authorId: user.id,
      topicId: d.topicId,
      chatDbId: d.chatDbId,
    });

    // Forward to chat
    if (ticket.target_chat_id) {
      try {
        const msgText =
          `📨 <b>Новий тікет #${ticket.id}</b>\n\n` +
          `📂 Тема: <b>${ticket.topic_name || '—'}</b>\n` +
          `👤 Автор: ${user.display_name || user.first_name || '—'} (@${user.username || '—'})\n\n` +
          `📝 <b>${ticket.title}</b>\n` +
          `${ticket.description || ''}\n\n` +
          (() => {
            const devs = stmts.listTopicDevs.all(d.topicId);
            const mentions = devs.filter(dev => dev.username).map(dev => `@${dev.username}`).join(' ');
            return mentions ? `👨‍💻 Відповідальні: ${mentions}\n\n` : '';
          })() +
          `<i>Щоб відповісти — Reply на це повідомлення</i>`;

        const sent = await ctx.api.sendMessage(ticket.target_chat_id, msgText, { parse_mode: 'HTML' });
        stmts.updateTicketChatMsgId.run(sent.message_id, ticket.id);

        // Save ticket message for reply tracking
        stmts.insertTicketMsg.run({
          ticket_id: ticket.id,
          sender_tg_id: user.telegram_id,
          text: d.title,
          user_dm_message_id: null,
          chat_message_id: sent.message_id,
        });
      } catch (e) {
        console.error('Failed to forward ticket to chat:', e.message);
      }
    }

    // Show ticket detail with close button
    await ctx.reply(`✅ Тікет #${ticket.id} створено та відправлено!`);

    ctx.session.state = 'user:tickets:detail';
    ctx.session.draft.detailTicket = ticket;

    const closeKb = new Keyboard();
    closeKb.text('🔒 Закрити тікет').row();
    closeKb.text('◀️ Назад').row();
    closeKb.resized().persistent();

    const emoji = { open: '🟢', in_progress: '🟡', closed: '🔴' };
    await ctx.reply(
      `${emoji[ticket.status] || '⚪'} <b>Тікет #${ticket.id}</b> — ${ticket.status}\n\n` +
      `📝 <b>${ticket.title}</b>\n${ticket.description || '—'}\n\n` +
      `📂 Тема: ${ticket.topic_name || '—'}\n` +
      `📅 Створено: ${ticket.created_at}`,
      { parse_mode: 'HTML', reply_markup: closeKb }
    );
    return true;
  }

  await ctx.reply('Натисніть ✅ Підтвердити або ❌ Скасувати.');
  return true;
}

// ==================== My Tickets ==================== //

async function handleTicketsList(ctx, text) {
  if (text === '◀️ Назад') { await sendUserMain(ctx); return true; }

  const match = text.match(/#(\d+)/);
  if (!match) return false;
  const ticketId = parseInt(match[1]);
  const ticket = stmts.getTicket.get(ticketId);
  if (!ticket) { await ctx.reply('Тікет не знайдений.'); return true; }

  ctx.session.state = 'user:tickets:detail';
  ctx.session.draft.detailTicket = ticket;

  const emoji = { open: '🟢', in_progress: '🟡', closed: '🔴' };
  const actions = new Keyboard();
  if (ticket.status !== 'closed') actions.text('🔒 Закрити тікет').row();
  actions.text('◀️ Назад').row();
  actions.resized().persistent();

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

  await ctx.reply(
    `${emoji[ticket.status] || '⚪'} <b>Тікет #${ticket.id}</b> — ${ticket.status}\n\n` +
    `📝 <b>${ticket.title}</b>\n${ticket.description || '—'}\n\n` +
    `📂 Тема: ${ticket.topic_name || '—'}\n` +
    `📅 Створено: ${ticket.created_at}` +
    historyText,
    { parse_mode: 'HTML', reply_markup: actions }
  );
  return true;
}

async function handleTicketDetail(ctx, text) {
  if (text === '◀️ Назад') {
    await sendUserMain(ctx);
    return true;
  }

  const ticket = ctx.session.draft?.detailTicket;
  if (!ticket) return false;

  if (text === '🔒 Закрити тікет') {
    stmts.setTicketStatus.run({ status: 'closed', id: ticket.id });
    await ctx.reply(`🔒 Тікет #${ticket.id} закрито.`);
    await sendUserMain(ctx);
    return true;
  }

  return false;
}

// ==================== User Reply to Ticket ==================== //

async function handleUserReply(ctx) {
  if (!ctx.message?.reply_to_message) return false;
  if (ctx.chat?.type !== 'private') return false;
  if (!ctx.session?.user || ctx.session.user.role !== 'user') return false;

  const repliedMsgId = ctx.message.reply_to_message.message_id;

  // Check if the replied message is a ticket notification from the bot
  const ticketMsg = stmts.findTicketMsgByDmId.get(repliedMsgId);
  if (!ticketMsg) return false;

  const ticket = stmts.getTicket.get(ticketMsg.ticket_id);
  if (!ticket) return false;

  // Verify this is the ticket author
  if (ticket.author_tg_id !== ctx.from.id) return false;

  // Check if ticket is closed
  if (ticket.status === 'closed') {
    await ctx.reply(`🔒 Тікет #${ticket.id} вже закритий. Відповідь не доставлена.`);
    return true;
  }

  if (!ticket.target_chat_id) {
    await ctx.reply('⚠️ Для цього тікета не знайдено чат підтримки.');
    return true;
  }

  const text = ctx.message.text || '[медіа]';
  const user = ctx.session.user;
  const userName = user.display_name || user.first_name || '—';
  const userUsername = user.username ? ` (@${user.username})` : '';

  // Forward to group chat as reply to the developer's message
  try {
    const replyToChatMsgId = ticketMsg.reply_chat_msg_id || ticket.chat_message_id;
    const sent = await ctx.api.sendMessage(
      ticket.target_chat_id,
      `👤 <b>Відповідь автора — тікет #${ticket.id}</b>\n\n` +
      `🗣 ${userName}${userUsername}:\n${text}`,
      {
        parse_mode: 'HTML',
        reply_parameters: replyToChatMsgId
          ? { message_id: replyToChatMsgId, allow_sending_without_reply: true }
          : undefined,
      }
    );

    // Save message for reply tracking
    stmts.insertTicketMsg.run({
      ticket_id: ticket.id,
      sender_tg_id: ctx.from.id,
      text: text,
      user_dm_message_id: null,
      chat_message_id: sent.message_id,
    });

    await ctx.reply('✅ Вашу відповідь доставлено в чат підтримки.');
  } catch (e) {
    console.error('Failed to forward user reply to chat:', e.message);
    await ctx.reply('❌ Не вдалося доставити відповідь.');
  }

  return true;
}

module.exports = { handleUser, handleUserReply, sendUserMain, isUser };
