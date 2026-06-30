const { parseModList } = require('./ModPacketParser');

class ModHandshakeHandler {
    constructor(bot, settings) {
        this.bot = bot;
        this.settings = settings;
        this.log = bot.sendLog;
        this.client = null;
        this.listeners = new Map();
        
        this.isAutoMode = settings.actionsPreset === 'auto';
        this.detectedLoader = this.isAutoMode ? null : settings.enableModLoader;
        this.detectedBrand = this.isAutoMode ? null : settings.enableCustomBrand;
    }

    attach(client) {
        if (!client) return;
        if (this.client === client) return;

        this.detach();
        this.client = client;

        const verbose = this.settings.verboseLogging !== false;

        // 1. Динамическая отправка бренда клиента
        const sendBrand = (channel, brandName) => {
            try {
                const brandBuffer = Buffer.from(brandName);
                const lengthBuffer = this.writeVarInt(brandBuffer.length);
                const payload = Buffer.concat([lengthBuffer, brandBuffer]);

                client.write('custom_payload', {
                    channel: channel,
                    data: payload
                });
                this.log(`[ModGuard] Успешно отправлен бренд клиента: "${brandName}"`);
            } catch (err) {
                this.log(`[ModGuard] Ошибка отправки бренда: ${err.message}`, 'error');
            }
        };

        const onCustomPayloadBrand = (data) => {
            if (data.channel === 'MC|Brand' || data.channel === 'minecraft:brand') {
                if (this.isAutoMode) {
                    // В авторежиме по умолчанию отправляем универсальный бренд "forge",
                    // так как его поддерживает большинство серверов
                    sendBrand(data.channel, 'forge');
                } else {
                    sendBrand(data.channel, this.detectedBrand || 'forge');
                }
            }
        };

        // 2. Имитация рукопожатия FML|HS (Legacy Forge)
        const onCustomPayloadFml = (data) => {
            if (data.channel === 'FML|HS') {
                if (this.isAutoMode && !this.detectedLoader) {
                    this.detectedLoader = 'forge';
                    this.log('[ModGuard] Автоопределение: Обнаружена проверка Forge модов на канале FML|HS.');
                }

                if (this.detectedLoader !== 'forge') return;

                try {
                    const buffer = data.data;
                    const discriminator = buffer[0];

                    if (discriminator === 0) {
                        this.log('[ModGuard] [FML|HS] Получен ServerHello. Отвечаю ClientHello...');
                        client.write('custom_payload', { channel: 'FML|HS', data: Buffer.from([1, 2]) });
                    } 
                    else if (discriminator === 2) {
                        const mods = parseModList(buffer);
                        this.log(`[ModGuard] [FML|HS] Получен список модов сервера. Модов требуется: ${mods.length}`);
                        
                        if (verbose && mods.length > 0) {
                            this.log(`[ModGuard] --- Список необходимых серверных модов ---`);
                            mods.forEach((mod, idx) => {
                                this.log(`  [${idx + 1}] ${mod.id} (v${mod.version})`);
                            });
                            this.log(`[ModGuard] ---------------------------------------`);
                        }

                        const response = Buffer.from(buffer);
                        response[0] = 2; // Перезаписываем дискриминатор
                        client.write('custom_payload', { channel: 'FML|HS', data: response });
                        this.log('[ModGuard] [FML|HS] Зеркальный список модов отправлен обратно.');
                    } 
                    else if (discriminator === 255) {
                        const fmlState = buffer[1];
                        if (fmlState === 3) {
                            client.write('custom_payload', { channel: 'FML|HS', data: Buffer.from([255, 4]) });
                            client.write('custom_payload', { channel: 'FML|HS', data: Buffer.from([255, 5]) });
                            this.log('[ModGuard] [FML|HS] Обход рукопожатия Forge успешно завершен.');
                        } else {
                            client.write('custom_payload', { channel: 'FML|HS', data: Buffer.from([255, fmlState]) });
                        }
                    }
                } catch (err) {
                    this.log(`[ModGuard] Ошибка обработки FML|HS: ${err.message}`, 'error');
                }
            }
        };

        // 3. Обход Login Plugin Request (Modern Forge / Fabric)
        const onLoginPluginRequest = (data) => {
            const isForgeChannel = data.channel.includes('forge') || data.channel.includes('fml');
            const isFabricChannel = data.channel.includes('fabric');

            if (this.isAutoMode && !this.detectedLoader) {
                if (isForgeChannel) {
                    this.detectedLoader = 'forge';
                    this.log('[ModGuard] Автоопределение: Выбран обход Forge на стадии авторизации.');
                } else if (isFabricChannel) {
                    this.detectedLoader = 'fabric';
                    this.log('[ModGuard] Автоопределение: Выбран обход Fabric на стадии авторизации.');
                }
            }

            if (isForgeChannel && this.detectedLoader === 'forge') {
                this.log(`[ModGuard] [Login] Обход запроса Forge на канале: ${data.channel}`);
                try {
                    client.write('login_plugin_response', {
                        messageId: data.messageId,
                        data: Buffer.alloc(0)
                    });
                } catch (err) {
                    this.log(`[ModGuard] Ошибка ответа на запрос Forge: ${err.message}`, 'error');
                }
            } else if (isFabricChannel && this.detectedLoader === 'fabric') {
                this.log(`[ModGuard] [Login] Обход запроса Fabric на канале: ${data.channel}`);
                try {
                    client.write('login_plugin_response', {
                        messageId: data.messageId,
                        data: Buffer.alloc(0)
                    });
                } catch (err) {
                    this.log(`[ModGuard] Ошибка ответа на запрос Fabric: ${err.message}`, 'error');
                }
            }
        };

        client.on('custom_payload', onCustomPayloadBrand);
        client.on('custom_payload', onCustomPayloadFml);
        client.on('login_plugin_request', onLoginPluginRequest);

        this.listeners.set('custom_payload_brand', onCustomPayloadBrand);
        this.listeners.set('custom_payload_fml', onCustomPayloadFml);
        this.listeners.set('login_plugin_request', onLoginPluginRequest);
    }

    detach() {
        if (!this.client) return;
        
        const onBrand = this.listeners.get('custom_payload_brand');
        const onFml = this.listeners.get('custom_payload_fml');
        const onLogin = this.listeners.get('login_plugin_request');

        if (onBrand) this.client.removeListener('custom_payload', onBrand);
        if (onFml) this.client.removeListener('custom_payload', onFml);
        if (onLogin) this.client.removeListener('login_plugin_request', onLogin);

        this.listeners.clear();
        this.client = null;
    }

    writeVarInt(val) {
        const buf = [];
        let num = val;
        while (true) {
            if ((num & 0xFFFFFF80) === 0) {
                buf.push(num);
                return Buffer.from(buf);
            }
            buf.push((num & 0x7F) | 0x80);
            num >>>= 7;
        }
    }
}

module.exports = { ModHandshakeHandler };