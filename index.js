const { ModHandshakeHandler } = require('./lib/ModHandshakeHandler');
const PLUGIN_OWNER_ID = 'plugin:mod-guard-bypass';

async function onLoad(bot, options) {
    const log = bot.sendLog;
    const settings = options.settings || {};

    log(`[bypass-mods] Инициализация плагина обхода проверок модов...`);

    const handler = new ModHandshakeHandler(bot, settings);

    bot.modGuardBypass = {
        handler,
        onLogin: () => {
            log('[bypass-mods] Бот зашел на сервер. Привязываю обход к активному соединению...');
            handler.attach(bot._client);
        }
    };

    if (bot._client) {
        handler.attach(bot._client);
    }

    bot.on('login', bot.modGuardBypass.onLogin);

    log(`[bypass-mods] Плагин успешно загружен и перешел в режим ожидания.`);
}

async function onUnload({ botId, prisma }) {
    try {
        await prisma.command.deleteMany({ where: { botId, owner: PLUGIN_OWNER_ID } });
        await prisma.permission.deleteMany({ where: { botId, owner: PLUGIN_OWNER_ID } });
    } catch (err) {
        console.error(`[bypass-mods] Ошибка при очистке БД: ${err.message}`);
    }
}

module.exports = {
    onLoad,
    onUnload
};