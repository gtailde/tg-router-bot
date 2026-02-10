/**
 * Fixed ReplyKeyboard definitions.
 * Admin and User see different keyboards. No inline — only persistent buttons.
 */
const { Keyboard } = require('grammy');

// ==================== ADMIN Keyboards ==================== //

const ADMIN_MAIN = new Keyboard()
  .text('👥 Користувачі').text('📂 Теми').row()
  .text('💬 Чати').text('📊 Тікети').row()
  .resized().persistent();

const ADMIN_USERS = new Keyboard()
  .text('➕ Додати користувача').row()
  .text('📥 Імпортувати юзерів').row()
  .text('📋 Список користувачів').row()
  .text('◀️ Головне меню').row()
  .resized().persistent();

const ADMIN_TOPICS = new Keyboard()
  .text('➕ Додати тему').row()
  .text('📋 Список тем').row()
  .text('◀️ Головне меню').row()
  .resized().persistent();

const ADMIN_CHATS = new Keyboard()
  .text('🔄 Оновити список чатів').row()
  .text('📋 Список чатів').row()
  .text('◀️ Головне меню').row()
  .resized().persistent();

const ADMIN_TICKETS = new Keyboard()
  .text('📊 Статистика').row()
  .text('📋 Всі тікети').text('📋 Відкриті тікети').row()
  .text('🟢 Відкриті').text('🟡 В роботі').text('🔴 Закриті').row()
  .text('👤 По юзеру').text('👨‍💻 По розробнику').row()
  .text('◀️ Головне меню').row()
  .resized().persistent();

const BACK_KB = new Keyboard()
  .text('◀️ Назад').row()
  .text('◀️ Головне меню').row()
  .resized().persistent();

const CANCEL_KB = new Keyboard()
  .text('❌ Скасувати').row()
  .resized().persistent();

const ROLE_KB = new Keyboard()
  .text('👤 User').text('👑 Admin').row()
  .text('❌ Скасувати').row()
  .resized().persistent();

const CONFIRM_KB = new Keyboard()
  .text('✅ Підтвердити').text('❌ Скасувати').row()
  .resized().persistent();

// ==================== USER Keyboards ==================== //

const USER_MAIN = new Keyboard()
  .text('📝 Створити тікет').row()
  .text('📋 Мої тікети').row()
  .resized().persistent();

const USER_CANCEL = new Keyboard()
  .text('❌ Скасувати').row()
  .resized().persistent();

const USER_CONFIRM = new Keyboard()
  .text('✅ Підтвердити').text('❌ Скасувати').row()
  .resized().persistent();

// ==================== Helpers ==================== //

/**
 * Build a dynamic keyboard from a list of items (e.g. topics, chats).
 * Each item becomes a button. Last row is cancel.
 */
function dynamicListKb(items, labelFn, opts = {}) {
  const kb = new Keyboard();
  if (opts.back !== false) {
    kb.text('❌ Скасувати').row();
  }
  for (const item of items) {
    kb.text(labelFn(item)).row();
  }
  return kb.resized().persistent();
}

module.exports = {
  ADMIN_MAIN, ADMIN_USERS, ADMIN_TOPICS, ADMIN_CHATS, ADMIN_TICKETS,
  BACK_KB, CANCEL_KB, ROLE_KB, CONFIRM_KB,
  USER_MAIN, USER_CANCEL, USER_CONFIRM,
  dynamicListKb,
};
