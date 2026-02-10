/**
 * Auto-close scheduler — closes stale tickets periodically.
 */
const { stmts } = require('./database');

let intervalHandle = null;

function startAutoClose(bot, { autoCloseMinutes, checkIntervalSeconds }) {
  if (!autoCloseMinutes || autoCloseMinutes <= 0) {
    console.log('[scheduler] Auto-close disabled (TICKET_AUTO_CLOSE_MINUTES=0)');
    return;
  }

  console.log(`[scheduler] Auto-close: check every ${checkIntervalSeconds}s, close after ${autoCloseMinutes}min`);

  intervalHandle = setInterval(async () => {
    try {
      const stale = stmts.getStaleTickets.all(autoCloseMinutes);
      for (const ticket of stale) {
        stmts.setTicketStatus.run({ status: 'closed', id: ticket.id });

        // Notify user
        if (ticket.author_tg_id) {
          try {
            await bot.api.sendMessage(
              ticket.author_tg_id,
              `🔒 <b>Тікет #${ticket.id} автоматично закрито</b>\n\n` +
              `Причина: неактивний понад ${autoCloseMinutes} хв.`,
              { parse_mode: 'HTML' }
            );
          } catch (e) { /* user blocked bot */ }
        }

        // Notify chat
        if (ticket.target_chat_id && ticket.chat_message_id) {
          try {
            await bot.api.sendMessage(
              ticket.target_chat_id,
              `🔒 Тікет #${ticket.id} автозакрито (неактивний > ${autoCloseMinutes} хв).`,
              { reply_to_message_id: ticket.chat_message_id }
            );
          } catch (e) { /* message deleted */ }
        }

        console.log(`[scheduler] Auto-closed ticket #${ticket.id}`);
      }
    } catch (e) {
      console.error('[scheduler] Error:', e.message);
    }
  }, checkIntervalSeconds * 1000);
}

function stopAutoClose() {
  if (intervalHandle) clearInterval(intervalHandle);
}

module.exports = { startAutoClose, stopAutoClose };
