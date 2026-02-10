/**
 * Reply handler — intercepts replies in support chats and routes them
 * back to the ticket author's DM.
 */
const { findTicketByChatMsgId, stmts } = require('../database');

async function handleChatReply(ctx) {
  // Only process group / supergroup messages that are a reply
  if (!ctx.message?.reply_to_message) return;
  if (ctx.chat?.type !== 'group' && ctx.chat?.type !== 'supergroup') return;

  // Check if this chat is registered
  const chatRow = stmts.getChatByChatId.get(ctx.chat.id);
  if (!chatRow || !chatRow.is_active) return;

  const repliedMsgId = ctx.message.reply_to_message.message_id;
  const ticket = findTicketByChatMsgId(repliedMsgId);
  if (!ticket) return; // not a ticket message

  const replyText = ctx.message.text || '[медіа]';
  const replierTgId = ctx.from?.id;
  const replierUser = replierTgId ? stmts.getUserByTgId.get(replierTgId) : null;
  const replierDisplayName = replierUser?.display_name || ctx.from?.first_name || 'Підтримка';
  const replierUsername = replierUser?.username || ctx.from?.username || null;
  const replierName = replierUsername ? `${replierDisplayName} (@${replierUsername})` : replierDisplayName;

  // If ticket is closed — notify developer and don't forward
  if (ticket.status === 'closed') {
    await ctx.reply(`🔒 Тікет #${ticket.id} вже закритий. Відповідь не доставлена.`);
    return;
  }

  // Mark ticket as in_progress if it was open
  if (ticket.status === 'open') {
    stmts.setTicketStatus.run({ status: 'in_progress', id: ticket.id });
  }

  // Touch updated_at
  stmts.setTicketStatus.run({ status: ticket.status === 'open' ? 'in_progress' : ticket.status, id: ticket.id });

  // Save the reply as a ticket message for further reply tracking
  stmts.insertTicketMsg.run({
    ticket_id: ticket.id,
    sender_tg_id: ctx.from?.id || 0,
    text: replyText,
    user_dm_message_id: null,
    chat_message_id: ctx.message.message_id,
  });

  // Send reply to the user's DM
  try {
    await ctx.api.sendMessage(
      ticket.author_tg_id,
      `💬 <b>Відповідь на тікет #${ticket.id}</b>\n` +
      `📂 ${ticket.title}\n\n` +
      `🗣 ${replierName}:\n${replyText}`,
      { parse_mode: 'HTML' }
    );
    await ctx.reply('✅ Відповідь доставлена користувачу.');
  } catch (e) {
    console.error('Failed to send reply to user:', e.message);
    await ctx.reply('❌ Не вдалося доставити відповідь користувачу.');
  }
}

module.exports = { handleChatReply };
